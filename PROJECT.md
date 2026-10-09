# NDSR — устройство проекта

NDSR — стенд техподдержки Keenetic. Инженеры через веб-портал бронируют реальные роутеры Keenetic и работают с ними удалённо: управляют питанием, делают перезагрузку и сброс, меняют тип WAN, переключают режим роутер/экстендер/MWS, открывают консоль и VNC, заливают прошивки и конфиги по TFTP.

Документ описывает, как всё устроено и где искать причину, если что-то сломалось. Пути в тексте указаны от корня репозитория, строки — на момент написания (октябрь 2026).

> Секреты (пароли, ключи) здесь намеренно не приводятся — только имена переменных и файлов, где они лежат.

---

## Содержание

1. [Общая схема](#1-общая-схема)
2. [Структура репозитория](#2-структура-репозитория)
3. [Инфраструктура и сеть](#3-инфраструктура-и-сеть)
4. [Бэкенд](#4-бэкенд-ndsr-appapi)
5. [Как бэкенд управляет железом](#5-как-бэкенд-управляет-железом)
6. [Протокол socket.io](#6-протокол-socketio)
7. [Фронтенд](#7-фронтенд-ndsr-app)
8. [Ключевые процессы](#8-ключевые-процессы)
9. [Конфигурация и данные](#9-конфигурация-и-данные)
10. [Деплой и эксплуатация](#10-деплой-и-эксплуатация)
11. [Диагностика: симптом → где смотреть](#11-диагностика-симптом--где-смотреть)
12. [Известные проблемы](#12-известные-проблемы)
13. [Безопасность](#13-безопасность)

---

## 1. Общая схема

```
 Инженер (браузер, VPN 172.16.x / 192.168.5.x)
    │  HTTP :80 (статика, /socket.io/ и /api/ — всё через nginx фронта)
    ▼                              ▼
 ┌──────────────────────── Docker host (DH / TRASP, VM на ESXi) ─────────────────────────┐
 │  ndsr-app-front (nginx+Vue)   ndsr-app-back (Node.js)   ndsr-webtelnet-console (Flask)│
 │        10.10.19.254                10.10.19.253                10.10.19.252           │
 │                                        │ SSH (docker exec, iptables/nft)              │
 │  Контейнеры CFK: KN-2610, KN-3710, ... (по одному на Keenetic, сеть ndsr_default     │
 │  10.10.19.0/24 + мост knXXXX → VLAN → LAN-порт реального Keenetic 192.168.1.1)       │
 └───────────────────────────────────────────────────────────────────────────────────────┘
                 │ HTTP (RCI API, через проброс портов)    │ telnet / TCP
                 ▼                                         ▼
   Роутеры Keenetic                  Лабораторное оборудование:
   (веб/RCI: checkUrl, URL)          • Jerome / PowerHub — питание, reboot, reset-кнопка
                                     • Коммутаторы (LAN, WAN) — VLAN, эмуляция провайдеров
                                     • VES (DSLAM) — сброс DSL-линии
                                     • MOXA — серийные консоли
```

Кто за что отвечает:

| Компонент | Ответственность |
|---|---|
| Фронтенд (Vue 3 + PrimeVue + Pinia) | UI, отображение состояния. Все действия отправляет через socket.io, файлы — через REST. |
| Бэкенд (Node.js, Express 5 + socket.io 4) | Бронирование, пароли, опрос статусов, команды оборудованию, проброс портов. Источник истины для брони и режимов. |
| Коммутаторы | Переключают тип WAN: VLAN на WAN-порту — это «провайдер». Соединяют экстендер с роутером для MWS. |
| Jerome / PowerHub | Реле питания (`rebootPort`) и «кнопки» сброса (`resetPort`). |
| CFK-контейнеры | Точка входа к конкретному Keenetic: DNAT на его веб, SSH, noVNC с Firefox, TFTP. |
| MOXA | Серийная консоль устройства (через webtelnet). |

---

## 2. Структура репозитория

```
README.md                  — старая инструкция по Terraform (только первый шаг деплоя)
PROJECT.md                 — этот документ
ndsr-app/                  — приложение
  src/                     — фронтенд (Vue)
    socket.js              — единственный socket.io-клиент
    App.vue, main.js
    stores/                — Pinia-сторы (логика клиента)
    components/            — UI
  vite.config.js, .env     — сборка и адреса бэкенда (VITE_*)
  api/                     — бэкенд
    server.js              — точка входа: Express, REST для файлов, socket.io, таймеры
    loadEnv.js             — dotenv, читает .env из текущего каталога
    resetDslLine.js        — сброс DSL-линии через VES
    devices.json, wan_types.json, users.json, badge.json, bookings.json
    src/
      socketHandler.js     — ≈70 строк: resolveClientIp + регистрация модулей socket/handlers
      bootstrap.js         — фоновые задачи при старте (статусы, брони, ночной cron)
      devices.js           — загрузка и сохранение JSON-конфигов, поиск устройств
      socket/wrap.js       — обёртка обработчиков (ack, ошибки)
      socket/handlers/     — обработчики по темам (booking, passwords, power, firmware, wan, mode, access, chat, admin)
      state/               — состояние в памяти и на диске
      services/            — бизнес-логика (бронь, пароли, статусы, MWS-связки, сброс, ночной cron, docker)
      actions/             — работа с железом и Keenetic API
      utils/               — docker, firewall, IP discovery, лимитер, PersistentMap
ndsr-deploy/
  Terraform/               — создание VM на ESXi
  Ansible/                 — настройка docker-хоста, CFK-контейнеров, запуск приложения
  Ovftool/                 — вендоренный VMware ovftool (нужен terraform-провайдеру esxi)
```

Направление зависимостей в бэкенде: `state ← services ← socket/handlers`. `actions/` и `utils/` не импортируют ни `services/`, ни socket-слой. Подробности — в разделе 4.

---

## 3. Инфраструктура и сеть

### 3.1 Физика и виртуализация

- **ESXi** 192.168.77.132, vSwitch `Public_int`. Terraform создаёт на нём portgroup `Trunk` (VLAN 4095 — все VLAN).
- **Docker host (DH, он же TRASP)** — VM `US07_DockerHost02`: Ubuntu 22.04, 6 vCPU, 10 ГБ RAM, один NIC в `Trunk`.
  - Управляющий IP 172.16.78.254, sshd на порту **9678**.
- Внутри DH netplan поднимает VLAN-сабинтерфейсы и мосты (`ndsr-deploy/Terraform/userdata.tpl`):
  - `internet` (vlan1604, DHCP) — внешняя сторона. Через неё приходят инженеры и выходит NAT.
  - `knXXXX` (VLAN 1904–1916, без IP) — по мосту на каждую модель Keenetic. Мост через коммутатор ведёт в LAN-порт реального роутера.

### 3.2 CFK-контейнеры (по одному на Keenetic)

Описаны в `ndsr-deploy/Ansible/roles/NDSR-Compose-role-UP/files/ndsr.yml`. Параметры контейнера:

- образ `systemd` (noVNC + systemd на Debian), загружается из tar на datastore ESXi;
- privileged, фиксированный MAC;
- две сети:
  - `ndsr_default` 10.10.19.0/24 (CFK получают 10.10.19.4–.16);
  - `knXXXX` через плагин **docker-net-dhcp**: интерфейс контейнера висит на мосту модели и получает DHCP-адрес от самого Keenetic (192.168.1.x).

Что происходит внутри CFK:

- DNAT `:<порт модели>` → `192.168.1.1:80`, TCPMSS, MASQUERADE (`scripts/setupIptablesCFK.sh`).
- systemd-юнит `monitorGw` (`changeContainersIp.sh`):
  - следит за шлюзом;
  - при потере DHCP ставит 192.168.1.254;
  - предпочитает 192.168.1.3 (AP) перед .1;
  - поддерживает DNAT в актуальном состоянии.
- `monitorRoute` (`monitorRoutes.sh`) добавляет маршруты к сетям инженеров через eth0.

Проброс портов на DH для каждого устройства (задан дважды: docker `ports:` и DNAT в `roles/SetupDockerHost/vars/main.yml`):

| Что | Порт на DH | Куда |
|---|---|---|
| Веб Keenetic | номер модели (напр. 2610) | CFK:2610 → 192.168.1.1:80 |
| SSH в CFK | 1926–1938 | CFK:22 |
| noVNC | 6804–6816 | CFK:6080 |

### 3.3 Контейнеры приложения

`roles/NDSR-APP-Compose-role-UP/templates/ndsr-app.yml.j2`, сеть `ndsr_default` (external, создаётся стеком CFK):

| Контейнер | IP | Порт | Что внутри |
|---|---|---|---|
| ndsr-app-front | 10.10.19.254 | 80 | nginx + собранный Vue; проксирует `/socket.io/` и `/api/` на бэкенд, выставляет `X-Real-IP` |
| ndsr-app-back | 10.10.19.253 | 3000 (только внутри `ndsr_default`, наружу не публикуется) | `node server.js` (node:20 alpine), env через `env_file` |
| ndsr-webtelnet-console | 10.10.19.252 | 5005→5000 | Flask-терминал к MOXA (github UrusovVladimir/flask-remote-terminal) |
| ndsr-guacd | 10.10.19.251 | 4822 (внутри сети) | guacd для RDP к тестовым VM в браузере (если `browser_rdp_enabled`) |

### 3.4 Внешнее оборудование

Адреса берутся из `ndsr-app/api/.env`. Индексы в `devices.json` 1-based: `jeromeID: 2` означает второй адрес из `JEROME_IPS` (`src/actions/getManagmentID.js`).

| Устройство | Переменные | Поле в devices.json | Протокол |
|---|---|---|---|
| Контроллер питания Jerome (old) / PowerHub (new) | `JEROME_IPS`, `JEROME_PORT` | `jeromeID`, `jeromeClass`, `rebootPort`, `resetPort` | old: telnet :2424 (`$KE,WR…`); new: TCP :23, CLI `channel N power/reset on/off` |
| LAN-коммутаторы | `SWITCH_IPs`, `SWITCH_LOGIN/PASSWORD` | `switchID`, `switchPortLan`, `vlanLocal` | telnet :23 (Zyxel-подобный CLI) |
| WAN-коммутаторы | `SWITCH_WAN_IPs` | `switchIDWan`, `switchPortWan`, `switchIDWanSecondary`, `switchPortWanSecondary` | telnet :23 |
| DSLAM (VES) | `VES_IP/PORT/LOGIN/PASSWORD` | `dslPort` | telnet, prompt `ras>` |
| Консоль-серверы MOXA | `MOXA_IPS` | `consoleID`, `consolePort` | ссылка `http://<moxa>/remote/telnet/telnet/<port>` |
| Docker host | `SSH_HOST/PORT/USERNAME/SSH_PRIVATE_KEY_PATH` | `hwId` (= имя CFK-контейнера) | SSH (ssh2), `sudo docker exec`, nft/iptables |

---

## 4. Бэкенд (`ndsr-app/api`)

### 4.1 Стек и запуск

- Node.js, ESM (`"type": "module"`). Основные пакеты: express 5, socket.io 4, multer 2, axios, ssh2, telnet-client, hash-wasm, node-cron.
- Запуск **обязательно из каталога `ndsr-app/api/`**: `.env` и `bookings.json` ищутся относительно cwd.
  - `npm run server-dev` — nodemon;
  - `npm run server-prod` — `node server.js`.
- Порт `WS_PORT`: 3000 по умолчанию.
- Фронт: пустые `VITE_WS_HOST`/`VITE_API_URL` — подключение к адресу страницы (так в проде, через nginx). Для локальной разработки — `ws://localhost:3000` / `http://localhost:3000`.

### 4.2 Последовательность старта

1. `server.js` импортирует `loadEnv.js` (dotenv), затем `utils/fileLogger.js` (дублирование логов в файл, см. 4.5).
2. Импорт `socketHandler.js` → `devices.js` **синхронно читает** devices, wan_types, users и badge JSON. Битый JSON или неверный путь роняет процесс сразу.
3. `state/modes.js` поднимает `PersistentMap` из `CURRENT_MODES_PATH` (по умолчанию `./current_modes.json`).
4. `state/mwsLinks.js` поднимает `PersistentMap` из `MWS_LINKS_PATH` (по умолчанию `./mws_links.json`).
5. `bootstrap.js` → `startBackgroundTasks()`:
   - `loadBookings()` — восстанавливает только неистёкшие брони на существующие устройства;
   - `scheduleNightlyReset()` — регистрирует ночной сброс в 04:00 (node-cron, Europe/Moscow). Выполняется он только при включённом флаге cron (см. 8.9);
   - первичный опрос статусов (`initializeStatusSystem`) и питания (`initializePowerStatus`, при ошибке считается `'on'`);
   - через 2 с — подключение по SSH к docker-хосту и создание `DockerManager`. При ошибке только warning, функции TFTP и проброса деградируют;
   - `autoReleaseOldBookings` каждые 60 с.
6. `server.js`:
   - создаёт `UPLOAD_DIR`;
   - Express с CORS `*`, REST для файлов;
   - socket.io (path `/socket.io/`, `maxHttpBufferSize` 5 МБ).
7. `initPasswordSystem(io)`: `setIO`, обнуление кэша статусов, генерация суточных паролей, проверка ротации каждые 5 мин.
8. На каждое подключение: `setupEvents(socket, io)` и `sendInitData(socket)`.
9. Каждые `STATUS_CHECK_INTERVAL` с — `broadcastDevicesStatus`. Выполняется только если есть клиенты; каждое устройство реально проверяется не чаще раза в 30 с.
10. Глобальный `unhandledRejection` логирует и продолжает работу. SIGTERM/SIGINT → graceful shutdown, через 5 с принудительный exit.

### 4.3 REST API (`server.js`)

Авторизации нет.

| Метод и путь | Назначение |
|---|---|
| `POST /api/upload` | Загрузка файлов (поле `files`, до 50 шт, до 100 МБ, только `.bin`/`.txt`), имя санитизируется |
| `GET /api/files` | Список файлов в `UPLOAD_DIR` |
| `GET /api/files/:filename` | Скачивание (защита от path traversal) |
| `DELETE /api/files/:filename` | Удаление |

Всё остальное идёт через socket.io (раздел 6).

### 4.4 Модули: кто за что

**`src/socketHandler.js`** — `resolveClientIp` (идентификация клиента, 8.1) и `setupEvents`, который вызывает `register(socket, io)` у всех модулей `socket/handlers/`. Своих обработчиков в нём больше нет.

**`src/socket/handlers/*.js`** — обработчики событий по темам; каждый модуль экспортирует `register(socket, io)`:

| Модуль | События | Заметки |
|---|---|---|
| `booking.js` | `device:book/extend/release/releaseMultiple/get-booking-status` | длительность — положительное число секунд |
| `passwords.js` | `device:getPassword/setPassword/clearPassword` | `setPassword` пишет в devices.json |
| `power.js` | `device:getPowerStatus/power/reboot/resetConfig/resetDslLine` | `setupDeviceOperation` + `startStatusMonitoring`; сброс — через `resetService` (8.10) |
| `firmware.js` | `device:getCurrentFW/checkMultipleFirmwares/clearFirmwareCache` | кэш 5 мин, `executeWithLimit` |
| `wan.js` | `device:getAllWanTypes`, `device:wanTypes:save` | одиночный и Dual WAN |
| `mode.js` | `device:changeMode/getCurrentMode/disconnectExtender/getModeInfo/getMwsConnection/mwsConnected` | режимы и MWS (8.5) |
| `access.js` | `device:getConsoleUrl`, `tftp:getInterfaceIp`, `device:init`, `device:forceStatusCheck` | |
| `chat.js` | чат, онлайн-пользователи, `disconnect` | история чата в памяти модуля |
| `admin.js` | `device:getInitData`, `cron:*`, `device:reloadConfigs`, `device:add/remove`, `user:*` | |
| `vm.js` | `vm:list`, `vm:attach`, `vm:detach`, `vm:getAccess`, `vm:renewIp` | тестовые VM (8.12) |

**`src/socket/wrap.js`** — страховочная обёртка, через неё зарегистрированы все обработчики (`on(socket, event, handler, opts)`):

- `callback` всегда функция; признак `callback.provided` показывает, прислал ли клиент ack;
- ack срабатывает один раз, повтор даёт `⚠️ [event] duplicate ack ignored`;
- аргументы выравниваются по `handler.length`, поэтому **у обработчиков нельзя делать default/rest-параметры**;
- sync throw и rejected promise дают `❌ [event] unhandled error:` и ack с ошибкой;
- форма ошибки: `{success:false,…}` (по умолчанию) или `{status:'error',…}` (`errorShape:'status'`);
- `{ack:false}` — для чата и disconnect.

**`src/state/`** — данные, без логики:

| Модуль | Что хранит | Где живёт |
|---|---|---|
| `bookings.js` | `deviceBookings`: id → `{bookedBy, expiresAt, accessPassword, passwordInvalidated}` | `bookings.json` (явный `saveBookings()`) |
| `modes.js` | `currentModes`: id → `{mode, routerId, timestamp}` | `current_modes.json` (PersistentMap, автосохранение на set/delete; изменение полей внутри объекта **не** сохраняется) |
| `mwsLinks.js` | `mwsLinks`: экстендер → `{routerId, routerIp, extenderIp, timestamp}` — IP, на которые стоят DNAT-пробросы MWS; запись есть, пока пробросы стоят | `mws_links.json` (PersistentMap, `MWS_LINKS_PATH`) |
| `passwords.js` | суточные пароли `{today, yesterday}` | память |
| `statusCache.js` | HTTP-статусы устройств, время проверок, флаги свежести | память |
| `power.js` | питание `'on'/'off'/'unknown'` | память |
| `firmware.js` | версия прошивки + время | память |
| `wan.js` | текущий тип WAN | память; копия в `device.currentWanType` (devices.json) |
| `runtime.js` | флаг cron (по умолчанию **выключен**) | память |
| `io.js` | экземпляр socket.io (`setIO`/`getIO`) | — |
| `consoleUrlCache.js` | ссылки на консоль MOXA (кэш 5 мин) | память |
| `vmAttachments.js` | VM → `{deviceId, bridge, attachedBy, attachedAt, ip, ipPending}` | `vm_attachments.json` (PersistentMap, `VM_ATTACHMENTS_PATH`) |

**`src/services/`** — бизнес-логика:

- `bookingService.js`:
  - `buildBookingPayload` — единый формат брони для клиента;
  - `emitBookingUpdate`;
  - `requireBooking` — проверка, что устройство забронировано этим IP;
  - `clearDevicePassword`;
  - `autoReleaseOldBookings`.
- `passwordService.js`:
  - кандидаты паролей и `tryWithPasswords`;
  - `isAuthError`;
  - cooldown 60 с после неудачной авторизации;
  - `getEffectiveDevicePassword` (для MWS-экстендера — пароль роутера);
  - `resolveRouterPassword` — пароль роутера для MWS-подключения (см. 8.3);
  - ротация суточных паролей.
- `statusService.js`:
  - `getDeviceStatusWithMode` — HEAD на `checkUrl`;
  - `waitForOnline`;
  - `executeWithLimit` (не больше 15 параллельных запросов);
  - `broadcastDevicesStatus`;
  - инициализация статусов и питания;
  - `clearFirmwareCache`.
- `progress.js` — события прогресса (`device:operationProgress`, `device:mwsOperationProgress`, `device:modeChangeProgress`). Имена событий — контракт с фронтом.
- `docker.js` — ленивый синглтон `SSHManager` + `DockerManager`.
- `wanService.js` — `getWanTypesSnapshot()`: текущие WAN-типы всех устройств (из `state/wan.js`, fallback — `device.currentWanType`). Нужен `sendInitData` и `device:getAllWanTypes`.
- `initData.js` — `sendInitData` (начальный пакет клиенту) и `sync*ToClient`.
- `bookingService.js` → `requireLinkAccess(socket, extenderId, routerId, {disconnect})` — права на операции со связкой экстендер→роутер: экстендер всегда в своей брони; подключение — роутер в своей брони; отключение — роутер свободен или в своей брони, но не в чужой.
- `linkService.js` — отключение экстендера от роутера без сокета (8.5):
  - `getActiveLink(id)` — `{routerId}`, если в `currentModes` записан `extender_connect`;
  - `releaseLinkInfrastructure(id, routerId)` — откат коммутатора и NAT без участия самого экстендера;
  - `finishApDisconnect` — хвост отключения AP-устройства (пробросы → ожидание загрузки → режим), общий для `device:mwsConnected` и ночного сброса;
  - `disconnectExtenderInBackground` — полное отключение для cron.
- `resetService.js` — `factoryResetDevice(io, id)`: заводской сброс со всей подготовкой и уборкой (8.10). Единственная точка входа для ручного и ночного сброса.
- `nightlyReset.js` — ночной cron (8.9).
- `vmService.js` — тестовые VM (8.12): атач/детач с блокировкой на VM, `reconcileVms` (раз в минуту из `bootstrap.js`), автодетач при снятии брони.

**`src/devices.js`**:

- массивы `devices`, `wanTypes`, `users`, `badgesConfig`;
- `getDeviceById`, `getParamRouter`;
- `saveConfig` — перезаписывает devices.json целиком;
- `reloadConfigs`;
- CRUD устройств и пользователей;
- `getDeviceStatusCode` — axios GET.

**`src/actions/`** и **`src/utils/`** — работа с железом, см. раздел 5.

### 4.5 Логи

Всё пишется в stdout/stderr (`docker logs -f ndsr-app-back`). Если задан `LOG_DIR`, `utils/fileLogger.js` дублирует вывод в `LOG_DIR/backend.log` с ротацией по размеру (`LOG_MAX_SIZE_MB`, `LOG_MAX_FILES`). Логи смешанные рус/англ. Префиксы:

| Префикс | Значение |
|---|---|
| ✅ | успех |
| ❌ | ошибка |
| ⚠️ | предупреждение |
| 🔑 | пароли и авторизация (логируются только источники, не значения) |
| 🛡 | guard / cooldown |
| 📡 | emit и синхронизация |
| 🔍 / 📊 | проверки статуса |
| 🔌 | питание и подключения |
| 🔗 | MWS / клиенты |
| 💾 | PersistentMap |
| 📂 | брони |
| 🧹 | очистка |
| 🚀 | старт |
| 🛑 | остановка |
| 💥 | unhandled rejection |

Также встречаются теги `[POWER]`, `[BOOK]`, `[STARTUP]`, `[<event>]` (из wrap). Метки в комментариях кода (`🔒 S1–S10`, `🔧 B1–B25`, `MWS-PW`) — ссылки на исправленные замечания ревью.

### 4.6 Рефакторинг `socketHandler.js` (завершён)

Бывший `socketHandler.js` на 3,5 тыс. строк разнесён по каталогам: `state/` → `services/` → `socket/wrap.js` → `socket/handlers/*.js`.

- Названия событий не менялись, фронт не трогали.
- Код переносился дословно (по диапазонам строк), поведение менялось только там, где закрывались замечания ревью (метки `🔧`/`🔒` в коде).
- Если после обновления что-то сломалось и непонятно где: найти обработчик события через `grep -rn "'<имя события>'" ndsr-app/api/src/socket/handlers/`, затем идти по импортам вниз (handler → services → actions/utils).
- Новые файлы (`state/`, `services/`, `socket/`, `bootstrap.js`, `utils/persistentMap.js`, `utils/createLimiter.js`, `utils/deviceFlags.js`, `utils/fileLogger.js`) на момент написания ещё не закоммичены.

---

## 5. Как бэкенд управляет железом

### 5.1 Как достучаться до устройства

- Бэкенд не ходит на LAN-IP роутера. Все HTTP-запросы идут на **`checkUrl`** (`http://<хаб>:<порт>` — проброс через CFK); для RCI роутера — на `URL`.
  - `getDeviceUrl()` всегда возвращает `checkUrl` (`services/statusService.js`).
  - Для определения режима сначала пробуется `checkDeviceMode`, если это поле задано.
- `hwId` устройства — это имя его CFK-контейнера на docker-хосте.
- **Экстендер за роутером (MWS).** Проброс в два слоя:
  - на хосте nft `dport <id экстендера>` → `router.ip`;
  - в контейнере роутера iptables `--dport <id экстендера>` → `<DHCP-IP экстендера>:80`.

  В итоге веб экстендера доступен по `http://<router.ip>:<extenderId>`, поэтому **`id` устройства одновременно используется как номер TCP-порта**.

### 5.2 Авторизация в Keenetic (`actions/athentication.js`)

Порядок `_authenticateCore`:

1. `GET /auth`. Ответ 200 означает, что уже авторизованы или пароль не задан.
2. Иначе ожидается 401 + cookie. Схема выбирается по заголовку `WWW-Authenticate`:
   - **ndw2** (классика): `md5(login:realm:password)` → `sha256(challenge + md5)` → `POST /auth`;
   - **ndw4** (новые прошивки): SCRAM-SHA3-512 + Argon2id, 3 POST, данные в `X-NDM-Data`.

Вокруг этого:

- `withAuthLock` — логины на один URL выполняются строго по очереди: параллельные `GET /auth` сбивают друг другу challenge.
- `makeAuthenticatedRequest` — запрос с сохранённой cookie. На 401 делает повторную авторизацию и один повтор.
- `sessionManager.js` — сессии в памяти, TTL 30 мин.
- Логин везде `admin` (захардкожено).

Используемые RCI-вызовы:

- `show/version`, `show/system/mode`, `show/mws`, `show/mws/candidate`, `show/ip/neighbor`, `show/ip/dhcp/bindings`, `show/ip/arp`;
- `POST system/mode`, `POST system/reboot`;
- batch `POST /rci/` — это `device:init`.

**Защита от блокировки адреса портала.** Keenetic после нескольких неудачных входов с одного адреса перестаёт ему отвечать: запросы висят до тайм-аута, пока роутер не перезагрузят. Бэкенд и браузеры пользователей ходят к устройству через один CFK-контейнер, поэтому блокируется всё сразу. Типичный сценарий (октябрь 2026): мастер настройки → перезагрузка → устройство вышло в сеть → сервер шлёт `device:checkFirmware` во все вкладки → несколько одновременных входов → первые ответы ndw4 сразу после загрузки без `X-NDM-Data` считались «неверным паролем» → перебор кандидатов → ~6 неудач за секунды → блокировка до перезагрузки. Сейчас:

- ошибка, при которой пароль не проверялся (сеть, тайм-аут, ndw4 без `X-NDM-Data` на фазе 1, неизвестная схема), помечается `isTransient`: перебор паролей на ней останавливается, неудачным входом не считается; `code` (ECONNREFUSED/ETIMEDOUT) сохраняется;
- ndw4 «не готов» (сразу после загрузки) — одна повторная попытка через 3 с;
- неверных паролей на один URL — не больше `AUTH_MAX_FAILS` (2) за `AUTH_FAIL_WINDOW_MS` (15 мин); дальше вход не пробуется до конца окна (`Login to … paused for Ns`); успешный вход и `device:setPassword` (новый пароль в портале) обнуляют счётчик;
- явная ошибка неверного пароля помечается `isAuthError`; `passwordService.isAuthError` сначала смотрит флаги, текст — только запасной вариант (`checkDeviceMode` передаёт флаги в результате);
- пакетная проверка прошивки — одна на устройство (`firmware.js` `checkFirmwareOnce`): параллельные запросы из разных вкладок ждут общий результат, свежий (30 с) отдаётся без входа.

**Замер на KN-3812 (5.02.B.0.0-0, октябрь 2026)**, по журналу роутера (`show log` через telnet из CFK-контейнера: `docker exec -i KN-<id> python3`, telnetlib на 192.168.1.1:23 — HTTP-бан на telnet не действует):

| Что делали с адреса контейнера | Результат |
|---|---|
| 8× `GET /auth` (401) подряд | бана нет |
| 8 успешных входов ndw4 подряд за 33 с | бана нет |
| неверные входы кодом бэкенда (`keeneticAuth`) по одному, KN-1012 | 4 — роутер отвечает; **5-й — бан** `Netfilter::Lockout::Manager: "Http": ban remote host <контейнер> for 15 minutes` |
| неверные пароли в веб-интерфейсе браузером (проверка пользователя) | бан примерно с 4–5-й попытки |

Лимит (5 неверных) общий для всех, кто ходит через контейнер: бэкенд(ы) и браузеры пользователей. Неудачная попытка в журнале роутера не пишется — виден только бан. Ping при бане проходит, HTTP висит; перезагрузка снимает бан. `ip http lockout-policy` на 5.02 только `enable`/`no` (порог и длительность — «obsolete»). Источники неверного пароля: устаревший `devicePassword`/суточный пароль у бэкенда, **второй бэкенд (dev) с другими суточными паролями и без прод-паролей, смотрящий на те же устройства**, браузер пользователя со старым паролем — все входят с одного адреса контейнера.

### 5.3 Питание, перезагрузка, сброс

| Операция | Модуль | Как сделано |
|---|---|---|
| Питание on/off | `actions/powerOnOff.js` | реле `rebootPort` на Jerome/PowerHub, 3 попытки |
| Статус питания | `actions/getPortPowerStatus.js` | new: парсинг `show channels`; old: `$KE,RID`. Параллельные вызовы делят один промис |
| **Reboot** | `actions/rebootDevice.js` | **жёсткий power-cycle**: off → 4 с → on (не RCI-reboot). Затем бэкенд опрашивает `checkUrl` каждые 5 с до 120 с |
| **Factory reset** | `services/resetService.js` → `actions/resetConfig.js` | «зажатие кнопки» `resetPort` на 10 с. Вокруг этого: отвязка MWS, WAN off, чистка пароля/режима/кэша — см. 8.10. Мониторинг до 180 с |
| Сброс DSL | `resetDslLine.js` | telnet на VES, `vdsl reset <dslPort>` |
| Смена DSL-типа | `actions/changeDslType.js` | **не реализовано** (заглушка) |

### 5.4 Тип WAN (`actions/changeWanType.js`)

WAN меняется **на порту WAN-коммутатора, а не на Keenetic**. Каждый тип из `wan_types.json` — это VLAN, в котором эмулируется провайдер (IPoE, PPPoE и т.д.).

Порядок команд:

1. Во всех VLAN из каталога порт делается `forbidden`.
2. `interface port-channel <port>` → `pvid <vlan>` → `no inactive`.
3. `vlan <vlan>` → `fixed`/`untagged <port>`.

Особые случаи:

- VLAN **4094** / `null` — «WAN выключен»: `pvid 4094` + `inactive`.
- Dual WAN `{type:'dual_wan', wan1, wan2}` использует `switchPortWan` и `switchPortWanSecondary`.
- Порты WAN могут быть на разных коммутаторах. `switchIDWan` / `switchIDWanSecondary` — номер в `SWITCH_WAN_IPs` с 1 (`SWITCH_WAN_IPs=192.168.77.220,192.168.77.221`: `"1"` → .220, `"2"` → .221). `switchIDWanSecondary` не задан или пуст — второй порт на том же свиче, что `switchIDWan` (так у NC-1013). Шаги группируются по адресу: один свич — одна telnet-сессия, порядок «основной порт → второй». Номера проверяются до первого подключения: неверный → `WAN switch #N (<поле>) is not in SWITCH_WAN_IPs`, ничего не меняется. При одиночном WAN и выключении второй порт гасится (`pvid 4094` + `inactive`) на своём свиче.
- **Один свич недоступен.** Свичи обрабатываются независимо: сбой одного не останавливает другой. По каждому порту `changeWanType` даёт результат (`applied` / `not changed — switch unreachable` / `skipped` / `failed during configuration, port state unknown`). Хоть один сбой — `WanSwitchError` с `results`. Все вызовы идут через `services/wanService.js` `applyWanChange(io, deviceId, wanData)`: всё применено — `status:'ok'`; часть — `status:'partial'`, сохраняется и рассылается (`device:wanTypeUpdated`) **фактическое** состояние (неприменённый порт — прежнее значение; например, Dual WAN при недоступном втором свиче превращается в обычный WAN на первом порту), фронт показывает жёлтое предупреждение с разбором по портам; ничего не применено — ошибка, состояние не меняется. Через `applyWanChange` работают `device:wanTypes:save`, выключение WAN при сбросе (частичное → `wanError`), `wan_off` при смене режима и cron выключения WAN.

Кто вызывает: `device:wanTypes:save`, смена режима с `wan_off`, отключение экстендера, **любой factory reset** (8.10).

Telnet-клиент (`telnetClassEthernet.js`) при обрыве переподключается и бросает `RECONNECTED`; `executeWithReconnect` делает до 3 повторов.

### 5.5 Docker-хост и firewall

- `actions/sshManager.js` — ssh2 по ключу.
  - По умолчанию добавляет к команде `sudo`, поэтому нужен sudo без пароля.
  - Ненулевой exit code **не считается ошибкой**.
- `utils/dockerManager.js` **не создаёт** контейнеры. Он:
  - смотрит интерфейсы (`docker exec <hwId> ip addr` — отсюда IP TFTP-сервера);
  - ставит и снимает DNAT в контейнере роутера;
  - через `UniversalFirewallManager` → `nftablesManager.js` правит nft на хосте (`ip nat PREROUTING`, fallback на iptables).
- IP, на которые поставлены MWS-пробросы, хранятся в `state/mwsLinks.js` (`mws_links.json`) и переживают рестарт: снятие правил берёт IP оттуда, а не ищет экстендер заново по DHCP.
- `utils/ipDiscovery.js` ищет IP экстендера по MAC: сначала в DHCP-bindings роутера, потом в ARP.

### 5.6 MWS и смена режима

См. раздел 8.5 — это самый сложный и хрупкий сценарий.

---

## 6. Протокол socket.io

Клиент идентифицируется **по IP** (раздел 8.1). Сразу после подключения сервер отправляет `CLIENT_IP`.

Колонка «Бронь» означает проверку `requireBooking`: устройство забронировано этим IP. «Связка» — `requireLinkAccess` (см. `bookingService`, 4.4): экстендер в своей брони, роутер — в своей (подключение) или свободен/в своей (отключение).

### 6.1 Клиент → сервер

| Событие | Аргументы → ack | Что делает | Бронь |
|---|---|---|---|
| `device:getInitData` | `()` → `{success}` | повторно отправить init-пакет | — |
| `device:book` | `{deviceId, duration}` (сек) → `{success, expiresAt, accessPassword, …}` | создать бронь; тот же IP может перебронировать, чужой — нет | своя/свободна |
| `device:extend` | `{deviceId, additionalDuration}` | продлить | владелец |
| `device:release` | `deviceId` или `{deviceId}` | снять бронь | владелец |
| `device:releaseMultiple` | `{deviceIds}` | снять несколько | владелец |
| `device:get-booking-status` | `deviceId` | payload брони | — |
| `device:getPowerStatus` | `deviceId` → `{success, status}` | опрос Jerome | — |
| `device:power` | `{deviceId, action:'on'/'off'}` → `{status:'ok', powerStatus}` | питание | ✔ |
| `device:reboot` | `deviceId` → `{status:'ok', deviceStatus:'online'/'timeout'}` | power-cycle + ожидание | ✔ |
| `device:resetConfig` | `deviceId` → как reboot | factory reset (8.10) | ✔; для подключённого экстендера — связка (отключение) |
| `device:resetDslLine` | `deviceId` → `{status}` | сброс DSL | ✔ |
| `device:init` | `{url, body, deviceId}` → `{success, data}` | прокси RCI-batch на устройство (Skip Wizard); SSRF-фильтр по хостам из devices.json | ✔ |
| `device:getPassword` / `setPassword` / `clearPassword` | `deviceId` / `{deviceId, password}` | пароль устройства в devices.json | ✔ |
| `device:getCurrentFW` | `{deviceId, login, password}` → `{success, sessionCookie:{release}}` или `{success:false, errorType}` | версия прошивки (кэш 5 мин, таймаут 30 с) | — |
| `device:checkMultipleFirmwares` | `{deviceIds, passwords?}` | пакетная проверка прошивок | — |
| `device:clearFirmwareCache` | `deviceId` | сбросить кэш прошивки | — |
| `device:forceStatusCheck` | `deviceId` → `{success, status, attempts}` | до 4 попыток с интервалом 5 с | — |
| `device:getAllWanTypes` | `()` → `{success, types}` | текущие типы WAN всех устройств | — |
| `device:wanTypes:save` | `(deviceId, vlanId или {type:'dual_wan',wan1,wan2})` → `{status, message}` | переключить WAN на коммутаторе | ✔ |
| `device:changeMode` | `{deviceId, mode, routerId?, password?, routerPassword?, action?}` → **сразу** `{success, async:true}`; итог приходит событием `device:modeChangeResult` | смена режима | ✔; для `extender_connect/_disconnect` — связка |
| `device:getCurrentMode` | `{deviceId, login?, password?}` → `{success, mode, hasMwsConnections}` | определить режим | — |
| `device:disconnectExtender` | `{deviceId, routerId, password}` | отключить экстендер от роутера | связка |
| `device:mwsConnected` | `{deviceId, routerId, action:'connect'/'disconnect', routerPassword?}` → `{status:'ok'}` или `{status:'error', error}` | MWS для AP с аппаратным переключателем | связка |
| `device:getMwsConnection`, `device:getModeInfo` | `deviceId` | информация о режиме и MWS | — |
| `device:getConsoleUrl` | `deviceId` → `{success, url}` | ссылка на MOXA (кэш 5 мин) | — |
| `tftp:getInterfaceIp` | `{tftpInterfaceName, deviceId}` → `{success, interfaceIp}` | IP TFTP в CFK-контейнере | — |
| `device:reloadConfigs` | `()` | перечитать JSON-конфиги, очистить кэши, разослать всем | — |
| `device:add` / `device:remove` | объект / `deviceId` | CRUD devices.json | — |
| `user:add/remove/updateName/getByIp/reload` | — | CRUD users.json | — |
| `cron:toggle` / `cron:get-status` | `bool` / `()` | флаг ночных задач | — |
| `chat_message`, `get_chat_history`, `user_typing`, `user_stop_typing` | — | чат | — |
| `vm:list` | `()` → `{success, vms}` | пул VM и их связки (без паролей) | — |
| `vm:attach` | `{vmId, deviceId}` → `{success, alreadyAttached}` | подключить VM в LAN устройства (в т.ч. конкурента) | ✔ |
| `vm:detach` | `{vmId}` | отключить свою VM | владелец VM |
| `vm:getAccess` | `{vmId}` → `{success, access:{host, port, username, password, ip}}` | данные для RDP-клиента | владелец VM |
| `vm:renewIp` | `{vmId}` | заново найти адрес VM в DHCP роутера | владелец VM |
| `vm:getRdpToken` | `{vmId}` → `{success, token, name}` | токен для RDP в браузере (если `GUACD_HOST` задан) | владелец VM |

Фронт отправляет ещё четыре события, у которых **нет обработчика на сервере**: `device:forceStatusCheckAll`, `device:updateShortName`, `password:generate`, `device:cancelOperation`. Их вызовы либо ничего не делают, либо уходят в таймаут.

### 6.2 Сервер → клиенты

| Событие | Payload | Когда |
|---|---|---|
| `CLIENT_IP` | строка | при подключении |
| `device:list` | устройства + `booking` + `powerStatus` | init, reloadConfigs, device:add/remove |
| `device:statuses:initial` | `[{deviceId, status}]` | init, reload |
| `device:status` | `{deviceId, status}` | изменение статуса при опросе, проверки, мониторинг операций |
| `device:bookingUpdated` | `{deviceId, booking}` | book/extend/release/auto-release/смена пароля |
| `device:bookings-list` | все брони | init, reload |
| `device:powerStatus` | `{deviceId, status, timestamp, …}` | питание |
| `device:passwordUpdated` | `{deviceId, password}` | set/clear пароля |
| `DAILY_PASSWORDS` | `{today, yesterday}` | init, ротация |
| `device:wanTypes`, `device:wanTypes:all`, `device:wanTypeUpdated` | каталог / карта / одно изменение | init, сохранение WAN |
| `device:modeUpdated`, `device:mwsStatusUpdated` | режим / MWS | init, смена режима, MWS |
| `device:modeChangeResult` | `{deviceId, success, mode, warning?, error?}` | финал `device:changeMode` |
| `device:operationProgress` | `{deviceId, progress, operationType}` | reboot, reset, DSL, init |
| `device:modeChangeProgress`, `device:mwsOperationProgress` | `{…, step}` | шаги смены режима и MWS; `step` должен совпадать с шагами в `ProgressModal.vue` |
| `device:checkFirmware` | `{deviceId, reason}` | через 5 с после перехода устройства в 200 |
| `device:currentFW` | `(deviceId, {FW})` | init (`FW={version,timestamp}`) и live (`FW={release}`) — **формы разные** |
| `device:users`, `cron:status`, `device:released`, `device:batch*Updated` | — | — |
| `vm:list` | `[{id, name, os, attachment:{deviceId, deviceName, attachedBy, attachedAt, ip, ipPending} \| null}]` | init и любое изменение VM |
| чат: `chat_history`, `chat_message`, `message_sent`, `online_users`, `system_message`, `user_typing`, `user_stop_typing` | — | — |

---

## 7. Фронтенд (`ndsr-app/`)

### 7.1 Стек и связь с бэкендом

- Vue 3 (`<script setup>`), **PrimeVue 3** (тема lara-light-indigo), Pinia 3, Vite 7.
- Иконки Bootstrap Icons грузятся с CDN jsdelivr: без интернета иконки пропадут.
- Dev-сервер: `npm run dev` → `0.0.0.0:8080`. Сборка — `npm run build`.
- Прокси в Vite **нет**, адреса задаются в `.env` и **вшиваются при сборке**. После смены адреса нужна пересборка.
  - `VITE_WS_HOST` — socket.io (`src/socket.js`);
  - `VITE_API_URL` — REST для файлов (`FileManager.vue`);
  - `VITE_PROJECT_NAME`, `VITE_IPERF_SERVER(_PUBLIC)`.
- Один socket-клиент на всё приложение (`src/socket.js`): websocket, затем polling, стандартный авто-reconnect. После reconnect клиент ничего не запрашивает сам — данные заново присылает сервер в init-пакете.

### 7.2 Сторы (`src/stores/`)

| Стор | Ответственность |
|---|---|
| `useDeviceStore` | Список устройств, брони, пользователи, WAN-карта; `bookedDevices` (мои) и `availableDevices` (остальные); CRUD. Слушатели: `device:list`, `device:status`, `device:bookingUpdated` и т.д. |
| `useDeviceActionsStore` | Питание, reboot, reset, DSL, init. `executeDeviceAction` не даёт запустить вторую операцию, пока идёт первая; **прогресс имитируется** (+5 % каждые 3 с до 80 %); ждёт ack (таймаут 130 с). Кэш TFTP-IP |
| `useModeStore` | Режим устройств, кэш в localStorage `deviceCurrentMode` (TTL 4 ч); `changeMode` ждёт `device:modeChangeResult` до 180 с |
| `useFirmwareStore` | Версии прошивок, кэш 5 мин, пакетная проверка |
| `useConsoleStore` | Попап консоли MOXA, cooldown 60 с (sessionStorage) |
| `useCronStore` | Переключатель ночных задач |
| `useChatStore` | Чат, упоминания, онлайн-пользователи |
| `useClipboardStore`, `useEscapeStore` | Буфер обмена (fallback для не-HTTPS), обработка Esc |

### 7.3 Компоненты

```
App.vue
├─ AppHeader — часы (МСК), суточный пароль, переключатель cron, FileManager
├─ DeviceDataTable — таблица устройств (не мои): вкладки Our Devices / Rival Devices в шапке, поиск, модалки, сохранение WAN/MWS
│   ├─ BookedDevicesTable — «мои устройства»: основное рабочее место (питание, reset, режимы,
│   │                        консоль, VNC, веб, Skip Wizard, продление, релиз, FW Check All)
│   ├─ BookingStatus — бронирование (слайдер длительности от 10 мин до 7 дней)
│   ├─ BookedByOther — чужая бронь: имя пользователя + «сколько осталось» (из `booking.expiresAt`, общие часы `composables/useNow.js`, тик 30 с; подсказка — время окончания)
│   ├─ PrimeDeviceModal — выбор WAN / MWS-подключение / FAQ
│   ├─ ChangeModeModal — смена режима
│   └─ ProgressModal — пошаговый прогресс (управляется событиями сервера)
├─ GlobalProgressDialog — прогресс операций из useDeviceActionsStore (прогресс имитированный)
├─ SidebarContent — счётчики, iPerf, reload configs, добавить/удалить устройство и пользователя
└─ ChatWidget (components/chat/*)
```

---

## 8. Ключевые процессы

### 8.1 Идентификация пользователя

Логинов нет, пользователь — это **IP-адрес** (`resolveClientIp`, `socketHandler.js`):

- При `TRUST_PROXY_HEADERS=true` IP берётся из `X-Real-IP`, затем из первого адреса `X-Forwarded-For`. Включать только за nginx, который эти заголовки перезаписывает.
- Иначе — реальный адрес сокета.
- `VPN_IP_PREFIXES` — только аудит: чужая подсеть даёт в логе `⚠️ Client from unexpected subnet`, но не блокируется.
- Имена пользователей берутся из `users.json` по IP.

Если брони «чужие» или кнопки неактивны, первым делом сравнить `CLIENT_IP`, который видит фронт, с `bookedBy` в брони. Типичные причины расхождения — NAT, прокси, смена VPN-адреса.

### 8.2 Бронирование

1. `device:book` создаёт бронь: `expiresAt = now + duration`, `accessPassword` = пароль устройства из конфига.
2. Изменения рассылаются всем (`device:bookingUpdated`) и сохраняются в `bookings.json` — брони переживают рестарт.
3. Длительность и продление — положительное число секунд (иначе отказ), верхнего предела нет. Снятие — вручную или через `autoReleaseOldBookings` (раз в 60 с).
4. Фронт тоже снимает истёкшие брони по таймеру в открытой вкладке.
5. Бронь требуют операции reboot, reset, power, DSL, init, работа с паролями, смена WAN и режима. Операции со связкой экстендер→роутер (MWS, отключение, сброс подключённого экстендера) дополнительно проверяют роутер — `requireLinkAccess`. CRUD устройств и пользователей, `reloadConfigs` и cron по-прежнему доступны всем (TODO S1).

### 8.3 Пароли устройств

Пароли устройств **намеренно открыты** всем пользователям портала: любой, кто взял устройство после другого, должен иметь возможность зайти на него без factory reset.

- Постоянный пароль — `device.devicePassword` в `devices.json`. Удаляется при factory reset: бронь остаётся, но помечается `passwordInvalidated`.
- **Суточные пароли**: случайные 8 символов (`actions/generatePassword.js`), `today` и `yesterday`.
  - Ротация проверяется каждые 5 мин по локальной дате сервера.
  - Хранятся **только в памяти**: после рестарта бэкенда генерируется новый `today`, а `yesterday` пуст.
- Порядок кандидатов при авторизации (`passwordService.getPasswordCandidates`):
  - интерактивно: явный пароль от клиента → пароль из конфига (для MWS-экстендера — пароль роутера) → пароль брони (только своей) → суточный today → yesterday;
  - фоново (пакетная проверка прошивок): сначала конфиг, потом явный пароль.
- **Cooldown 60 с**: если не подошёл ни один кандидат, устройство блокируется на 60 с. Это защита IP сервера от антибрутфорса Keenetic.
- **Пароль роутера для MWS-подключения** (`device:changeMode` с `extender_connect`, `device:mwsConnected` с `connect`) — `passwordService.resolveRouterPassword`:
  - в UI два варианта: «Router Password» (клиент шлёт `routerPassword: null`) или ручной ввод;
  - `null` → кандидаты **самого роутера** (его конфиг → его бронь пользователя → суточные); пароль экстендера не используется никогда;
  - ручной пароль пробуется только он сам, без подстановок;
  - пароль проверяется запросом `/rci/show/version` к `router.URL` **до** перенастройки коммутатора; не подошёл → операция не начинается, клиенту уходит ошибка с просьбой ввести пароль вручную;
  - отключению (`disconnect`, `extender_disconnect`) пароль роутера не нужен — секция в UI скрыта.

### 8.4 Статус устройства

- Код статуса — реальный HTTP-код ответа `HEAD checkUrl`. **200 = онлайн**, **0** = сетевая ошибка/таймаут, другие коды показываются как есть.
- «Немедленная» проверка (axios GET без редиректов) на любую ошибку возвращает **500**, поэтому `forceStatusCheck` повторяет попытку только на 500. Два пути проверки дают разные коды на одну и ту же ошибку.
- Реальная частота опроса — около 30 с на устройство. Статусы рассылаются только при изменении.
- Первый переход в 200 через 5 с запускает `device:checkFirmware` на фронте.

### 8.5 Режимы: роутер / экстендер / MWS

Значения режима: `router`, `extender`, `extender_connect` (экстендер подключён к `routerId` по MWS), `extender_disconnect` (операция, которая заканчивается в router или extender). Источник истины — `currentModes` на сервере (`current_modes.json`); фронт держит копию в localStorage.

Если у устройства `hwType` = `true/yes/1` (`utils/deviceFlags.isApSwitchOn`), режим задаётся аппаратным переключателем: программная смена режима запрещена, после ребута устройство всегда в `extender`.

Какой путь выбирает фронт (`PrimeDeviceModal.saveChanges`):

| Устройство | Подключение / отключение |
|---|---|
| `hwType` = true (AP-переключатель) | `device:mwsConnected` `connect` / `disconnect` |
| остальные | `device:changeMode` `extender_connect` / `extender_disconnect` |

**`device:changeMode`** (`socket/handlers/mode.js` → `actions/changeModeType.js`):

1. `requireLinkAccess`, guard аппаратного переключателя, guard cooldown.
2. **Проба авторизации до любых изменений**: `GET /rci/show/system/mode` по кандидатам.
   - не подошёл ни один пароль → cooldown 60 с и отказ;
   - сетевая ошибка → «Device is unreachable», отказ **без** cooldown.
3. Для `extender_connect` — пароль роутера (`resolveRouterPassword`, 8.3).
4. Сразу ack `{async:true}`. Дальше прогресс идёт событиями `device:modeChangeProgress`.
5. Если `action:'wan_off'` — выключить WAN на коммутаторе.
6. `changeSystemMode`: `POST /rci/system/mode` → через 2 с `POST /rci/system/reboot`.
7. Для экстендера с `routerId`:
   - `connectToMws` — VLAN роутера на LAN-порт экстендера;
   - ожидание экстендера в `show/mws/candidate` / `show/ip/neighbor` — **до десятков минут**;
   - проброс портов (`DockerManager.setupPortForwarding`, пишет `mwsLinks`).
8. Ожидание загрузки → `currentModes.set` (только при успехе) → `waitForOnline` → события `device:modeUpdated`, `device:mwsStatusUpdated` и `device:modeChangeResult`.

**Отключение обычного экстендера** (`extender_disconnect` → `disconnectAndChangeToRouter`; `device:disconnectExtender` → сразу шаг 2):

1. WAN off (`changeWanType(null)`).
2. `DisconnectManager.fullDisconnect` (`utils/disconnectManager.js`):
   1. команда смены режима на самом экстендере;
   2. 15 с ожидания;
   3. `reconfigureSwitchWithLocalVlan` — коммутатор;
   4. `removeIptablesRulesOnly` → `removePortForwarding` — NAT и `mwsLinks`;
   5. проверка доступности: до 20 попыток × 15 с.
3. 30 с + ожидание загрузки; итоговый режим `router` (или `extender` при AP-переключателе).

> Если шаг 2.1 падает (экстендер недоступен, пароль не подошёл), шаги 2.3–2.4 **не выполняются**: коммутатор и NAT остаются в состоянии «подключено». Таймаут на 2.1 `disconnectAndChangeToRouter` считает «устройство перезагружается» и возвращает успех с `warning`. Ручное отключение в этом случае надо повторить; ночной сброс и factory reset этот случай обходят (`releaseLinkInfrastructure`).

**`device:mwsConnected`** (AP с аппаратным переключателем):

- connect: `requireLinkAccess` → пароль роутера → `connectToMws` (VLAN) → `currentModes = extender_connect` → `MWSConnectionManager.setupMWSConnection` (пробросы, `mwsLinks`).
- disconnect: `connectToMws` disconnect (VLAN обратно + **power-cycle** через Jerome) → `linkService.finishApDisconnect`: снятие пробросов (`removeMWSConnection`) → ожидание загрузки (до 60 с) → режим.
- Ошибка пробросов после того, как коммутатор уже перенастроен, режим **не** откатывает, но ack уходит `{status:'error'}` и прогресс `error`. При disconnect запись `mwsLinks` остаётся — повторный disconnect дочистит правила.

**Что создаёт подключение и что его снимает:**

| Где | Подключение создаёт | Снимает | Как проверить вручную |
|---|---|---|---|
| LAN-коммутатор, порт экстендера (`switchPortLan`) | `pvid <vlanLocal роутера>` | `pvid <vlanLocal экстендера>` | `show vlan` / конфиг порта |
| LAN-коммутатор, VLAN роутера | порт экстендера `fixed`/`untagged` + `vlan-trunking` на портах экстендера и роутера (`port`) | порт экстендера `forbidden` (**`vlan-trunking` не снимается**, см. 12.1) | `show vlan <vlanLocal роутера>` |
| Docker-хост, nft/iptables | DNAT `dport <extenderId>` → `router.ip` | удаляется | `nft list table ip nat \| grep <extenderId>` |
| CFK-контейнер роутера (`router.hwId`) | DNAT `--dport <extenderId>` → `<IP экстендера>:80` | удаляется | `docker exec <router hwId> iptables -t nat -S PREROUTING \| grep <extenderId>` |
| `mws_links.json` | `{routerId, routerIp, extenderIp}` | удаляется после снятия DNAT | файл в каталоге состояния |
| `current_modes.json` | `extender_connect` + `routerId` | `router` / `extender` (или запись удаляется при сбросе) | файл в каталоге состояния |
| Сам роутер | экстендер в MWS (candidate → member) | **не снимается** — стирается только сбросом роутера | `show mws` на роутере |

Согласованное состояние — либо всё из таблицы есть (подключено), либо ничего нет. Все операции снятия **идемпотентны** (правила сначала ищутся, удаляются только найденные; `pvid`/`forbidden` просто выставляются заново), поэтому при «полуразобранной» связке безопасно повторить отключение или сделать factory reset экстендера.

### 8.6 Тип WAN

1. UI: `WanTypeDisplay` → `PrimeDeviceModal` → `DeviceDataTable.handleWanSave` → `device:wanTypes:save`.
2. Сервер валидирует dual WAN, переключает VLAN на WAN-коммутаторе (5.4), сохраняет `device.currentWanType` в devices.json и рассылает `device:wanTypeUpdated`.
3. Фронт ждёт ack 30 с (dual WAN — 60 с).

### 8.7 Прошивки и конфиги по TFTP

Бэкенд **не заливает** файлы на устройство сам. Процесс:

1. FileManager загружает `.bin`/`.txt` на сервер (`POST /api/upload` → `UPLOAD_DIR`).
2. DeviceSelector: инженер выбирает своё онлайн-устройство. UI показывает IP TFTP-сервера (`tftp:getInterfaceIp`: `docker exec <hwId> ip addr show <tftpInterfaceName>` по SSH).
3. Устройство тихо перезагружается (или включается питание), открывается консоль MOXA.
4. Инженер вручную прошивает файл из загрузчика по TFTP.

Версия прошивки: `device:getCurrentFW` (авторизация → `show/version` → `release`) или пакетно `device:checkMultipleFirmwares`.

### 8.8 Консоль, VNC, веб

- **Консоль** — `device:getConsoleUrl` → `http://<MOXA>/remote/telnet/telnet/<consolePort>`, открывается попапом. Доступна только владельцу брони, после открытия действует cooldown 60 с.
- **VNC** — `device.vncUrl` (noVNC в CFK).
- **Веб** — `device.URL`.

### 8.9 Ночные задачи (cron)

`services/nightlyReset.js`, регистрируется из `bootstrap.js` (node-cron, Europe/Moscow). Выполняется **только если флаг cron включён** в шапке портала. Флаг хранится в памяти и после рестарта бэкенда **выключен**.

В 04:00 `resetAllDevices()`:

1. **Отключение подключённых экстендеров** (`disconnectLinkedExtenders`): все записи `extender_connect` в `currentModes`, по одной, через `linkService.disconnectExtenderInBackground` — тем же путём, что и из UI (8.5): AP-переключатель → как `mwsConnected disconnect`, иначе → `disconnectAndChangeToRouter` с фоновым подбором пароля.
   - если у обычного экстендера не прошёл шаг на самом устройстве (недоступен, пароль, таймаут) — коммутатор и NAT всё равно откатываются (`releaseLinkInfrastructure`), режим вернёт сброс;
   - у AP при ошибке снятия пробросов делается повторная попытка через `removeIptablesRulesOnly`.
2. **Factory reset** всех незабронированных устройств через `resetService.factoryResetDevice` (8.10), пауза 2 с между устройствами.

Кого пропускает:

| Ситуация | Что происходит |
|---|---|
| устройство конкурента (`rivals: true`) | никогда не сбрасывается |
| устройство забронировано | не трогается |
| экстендер свободен, его роутер забронирован | связка не трогается, экстендер не сбрасывается |
| отключение экстендера не удалось | не сбрасываются **ни экстендер, ни его роутер** — связку надо разобрать вручную (8.5, таблица) |

Каждый экстендер отключается около 2 минут, поэтому при нескольких связках сброс устройств начинается позже 04:00.

Отдельной задачи «WAN off в 02:50» больше нет: WAN выключается в самом сбросе. Старая задача рвала MWS-связки до их отключения.

`actions/readConfig.js` — старая копия resetConfig с прежними cron-задачами. Не импортируется; если его подключить, задачи будут выполняться дважды.

Ручной запуск на dev без ожидания 04:00 (cron включить в UI или `setCronEnabled(true)`):

```sh
cd ndsr-app/api
node --env-file=.env --input-type=module -e "
const { setCronEnabled } = await import('./src/state/runtime.js');
const { loadBookings } = await import('./src/state/bookings.js');
const { resetAllDevices } = await import('./src/services/nightlyReset.js');
loadBookings(); setCronEnabled(true); await resetAllDevices(); process.exit(0);"
```

> Это реально сбрасывает все незабронированные устройства стенда. `loadBookings()` обязателен — без него брони пусты и сбросятся и занятые устройства. Если бэкенд стенда запущен параллельно, он не узнает об изменениях `current_modes.json` до рестарта — запускать при остановленном бэкенде. Суточные пароли в таком запуске не генерируются: для обычных экстендеров используется только пароль из конфига (иначе сработает откат инфраструктуры без смены режима).

### 8.10 Factory reset

Единая точка — `services/resetService.factoryResetDevice(io, deviceId)`; её вызывают `device:resetConfig` (`socket/handlers/power.js`) и ночной сброс. Устройство конкурента (8.11) она отклоняет сразу. Порядок:

1. **MWS-связка.** Если устройство — подключённый экстендер (`getActiveLink`), `releaseLinkInfrastructure` откатывает коммутатор (`reconfigureSwitchWithLocalVlan`) и NAT (`removeIptablesRulesOnly`, удаляет и `mwsLinks`), снимает запись из `currentModes`, шлёт `device:mwsStatusUpdated: disconnected`. Режим на самом экстендере не меняется — его вернёт сброс.
   - **Не получилось — сброс не начинается**, ошибка уходит клиенту, связка остаётся как была.
2. **WAN off** — `changeWanType(id, '4094')` (у Dual WAN оба порта), `device.currentWanType = '4094'` в devices.json и `currentWanTypes`, событие `device:wanTypeUpdated` (на фронте «Not configured»). Ошибка WAN сброс **не** останавливает (возвращается в `wanError`, пишется в лог).
3. **Сброс** — `actions/resetConfig.js`, кнопка `resetPort` на Jerome/PowerHub.
4. **Уборка** — `clearDevicePassword` (пароль из конфига, бронь помечается `passwordInvalidated`), `currentModes.delete`, `clearFirmwareCache`.

Права при ручном сбросе (`setupDeviceOperation`, параметр `checkAccess`): своя бронь на устройство; если это подключённый экстендер — ещё и роутер свободен или в своей брони, иначе отказ «Router is booked by another user» до любых действий.

Если сбрасывается **роутер**, к которому подключены экстендеры, их связки не снимаются (12.1).

Что искать в логе:

| Строка | Значит |
|---|---|
| `🔗 <id> is linked to router <r> — reverting switch and NAT before reset` | начат откат связки |
| `🔌 WAN turned off for <id> before reset` | WAN выключен |
| `❌ Failed to turn off WAN for <id>: … — resetting anyway` | WAN не выключен, сброс продолжен |
| `🧹 currentModes cleared for <id> after factory reset` | сброс и уборка закончены |
| `Disconnecting extender <id> from router <r> before reset...` | ночь: начато отключение |
| `⚠️ <id>: device-side disconnect failed (…) — reverting switch and NAT anyway` | ночь: экстендер не ответил, идёт откат инфраструктуры |
| `Failed to disconnect extender <id> … — skipping reset of both` | ночь: связку надо разбирать вручную |
| `Skipping <hwId> — MWS link not disconnected` / `— booked` | ночь: устройство пропущено |

### 8.11 Устройства конкурентов (`rivals: true`)

Устройство с `"rivals": true` в `devices.json` — роутер или точка доступа конкурента. Бронируется как обычно, но управлять им можно только через **VNC** и **веб-интерфейс**; подключать к нему тестовые VM тоже можно (8.12). Признак — `isRival()` в `api/src/utils/deviceFlags.js` и `src/utils/deviceFlags.js` (принимает `true` и `"true"`).

**UI:**

- Таблица под «My Booked Devices» разделена на вкладки **Our Devices** / **Rival Devices** — переключатель на месте старого заголовка «All Devices». Выбор помнится в localStorage (`devicesTableView`), счётчики online/offline/total — по текущей вкладке.
- Rival Devices: колонки Status, Device (картинка, имя, hwId, страна, **пароль** из `devicePassword` в конфиге с кнопкой копирования), HW Type, Booking, Actions; в Actions только VNC (если есть `vncUrl`) и веб (`URL`), активны для своей брони.
- Забронированный конкурент попадает в «My Booked Devices» с меткой `Rival`: Firmware и WAN — `N/A`, строка режима скрыта, пароль — из конфига с копированием (без редактирования: `device:setPassword` для конкурентов запрещён), в Actions и в меню быстрых действий остаются только VNC, веб и снятие брони (остальные кнопки скрыты). Продление брони работает.
- Конкуренты исключены из: «FW Check All» и автопроверки прошивки, автоопределения режима, списков роутеров для MWS и смены режима, выбора устройства для TFTP.

**Сервер** (защита не только в UI) отвечает `Not available for rival devices.` на: reboot, reset, power, сброс DSL, смену WAN, смену режима / MWS / отключение экстендера (через `requireLinkAccess` — и если конкурент экстендер, и если роутер), `device:init`, консоль, TFTP, пароли. `device:getCurrentFW` → `{success:false, errorType:'not_supported'}`, пакетная проверка прошивок пропускает их, `device:checkFirmware` для них не рассылается. Ночной сброс их пропускает (`Skipping <hwId> — rival device`). Статус и питание опрашиваются как обычно.

Добавить конкурента — поле `"rivals": true` в `devices.json` (в проде — `ndsr-state/devices.json`) и `device:reloadConfigs`; в форме добавления устройства в UI этого поля пока нет.

### 8.12 Тестовые VM (Windows в LAN устройства)

Инженер подключает к своему забронированному устройству одну или несколько Windows VM: VM попадает в LAN роутера (получает адрес от самого Keenetic, ходит в интернет через него), а инженер заходит на неё по RDP — штатным клиентом Windows (mstsc) или прямо из браузера; ставить ничего не нужно. VM живёт, пока жива бронь.

У VM два адаптера: **LAN** (смотрит в LAN роутера, DHCP) и **Mgmt** (служебный: только RDP к VM, статический адрес без шлюза). В Windows бэкенд не заходит — входящих портов, кроме RDP, у VM нет. Windows о VLAN ничего не знает — «переключение кабеля» LAN делает docker-хост.

```
ESXi vSwitch Public_int (uplink → коммутатор стенда, tagged VLAN LAN устройств)
 ├─ PG Trunk   (4095) → docker-хост: int ─┬─ vlan1904 ─── br kn2610 (CFK KN-2610)
 │                                        ├─ ndsr-l4080 ─ br ndsr-lan4080 (создаёт бэкенд)
 ├─ PG vm1-lan (3001) ────────────────────┼─ ndsr-vm3001 ──┘ при атаче к NC-1013 (vlanLocal 4080)
 ├─ PG vm2-lan (3002) ────────────────────┼─ ndsr-vm3002     запаркован — ни в каком мосту
 └─ PG vm-mgmt (3100) ────────────────────┴─ vmmgmt 10.10.31.1/24 ← RDP (DNAT / guacd)
```

**Атач** (`vmService.attachVm`): своя бронь (конкурентам тоже можно — Windows-клиент за чужим роутером нужен для сравнения), VM свободна или уже своя (иначе «VM is used by another user») →
1. Trunk-интерфейс хоста: `VM_TRUNK_IFACE`, если такое устройство есть, иначе родитель существующих VLAN-интерфейсов (`vlan4064@ens160` → `ens160`; в netplan `ethernets: int: match:` без `set-name` имя `int` в системе не появляется).
2. LAN устройства: поле `bridge` в `devices.json` (ручное переопределение) или **`vlanLocal`** устройства — тот же VLAN, что PVID на его LAN-порту (подключённый экстендер — `vlanLocal` его роутера). На docker-хосте ищется VLAN-интерфейс с этим id на trunk: если он в мосту (как `vlan1904` в `kn2610` у CFK) — используется этот мост; если нет — создаются `ndsr-l<vlan>` (VLAN на `int`) и мост `ndsr-lan<vlan>`;
3. `ip link add link <trunk> name ndsr-vm<vlan VM> type vlan id <vlan VM>` (если нет) → `ip link set ndsr-vm<vlan VM> master <мост>`;
4. RDP (адрес-источник проверяется до любых изменений сети; `rdpPort` должен быть свободен на хосте — любое DNAT-правило с этим портом считается правилом VM и снимается при детаче): `iptables -t nat -I PREROUTING -i internet -s <IP владельца> --dport <rdpPort> -m comment --comment ndsr-vm-<id> -j DNAT --to-destination <mgmtIp>:3389` (старые правила этой VM снимаются);
5. запись в `vm_attachments.json` (`deviceId, bridge, lanVlan, attachedBy, …`), рассылка `vm:list`;
6. фоном: адрес VM — из таблицы DHCP того Keenetic, что раздаёт адреса в этом LAN (RCI `/show/ip/dhcp/bindings`, по `lanMac` из `vms.json`; подключённый экстендер — его роутер), `services/vmIpLookup.js`. После атача — до 9 опросов раз в 10 с (сторож в Windows обновляет DHCP за ~30 с), дальше сверка: нет адреса — раз в минуту, есть — раз в 5 минут. Пароль — кандидаты устройства (`getPasswordCandidates`, background), после провала авторизации — пауза (cooldown). У конкурентов адрес «неизвестен» (RCI нет).

Требование к сети стенда: VLAN LAN устройств (`vlanLocal`) должны приходить на docker-хост. На текущем стенде (netplan, октябрь 2026) так и есть: `vlan4064`…`vlan4080` на `int`, каждый в мосту CFK (`kn2710`, `kn4310`, `nc10131` и т.д.), у конкурентов — `riv101`…`riv104` (VLAN 101–104). Поэтому VM подключается в уже существующий мост устройства, свои `ndsr-lan*` создаются только для VLAN, которого на хосте нет. VLAN самих VM (30xx) и mgmt (3100) в netplan не заняты.

**Детач** — `nomaster`, снятие правил `ndsr-vm-<id>` (Windows отпустит адрес сама — сторож увидит, что шлюз пропал); свой мост `ndsr-lan<vlan>` удаляется, если в нём больше нет VM (мосты CFK не трогаются). Автоматически: при снятии брони (`device:release`, `releaseMultiple`) и в `reconcileVms` (раз в минуту): бронь истекла / снята / сменился владелец → детач. Factory reset VM не отцепляет — после сброса роутера нажать «Renew DHCP» в диалоге.

**Сторож LAN в Windows** (`NDSR-LanWatchdog`, задача планировщика от SYSTEM при старте, скрипт `C:\ProgramData\NDSR\lan-watchdog.ps1`, журнал `lan-watchdog.log` рядом). Windows не замечает, что docker-хост «переткнул» её LAN в другой мост. Раз в 10 с сторож проверяет адаптер LAN: нет адреса, шлюз не отвечает (ping, затем TCP 80) две проверки подряд или сменился MAC шлюза (другой роутер с той же подсетью) → `ipconfig /release` + `/renew`, не чаще раза в минуту.

**Адрес в портале** (диалог VM): IP из DHCP роутера; «Waiting for DHCP…» — идёт опрос; иначе причина: нет `lanMac` в `vms.json`, роутер конкурента (смотреть `ipconfig` в Windows), не подошёл пароль роутера / пауза после неудачи, роутер недоступен, VM ещё нет в таблице DHCP. ⟳ — найти адрес заново.

Снятие RDP-правил: если в `nat PREROUTING` есть нативные правила nft, `iptables -S` падает («chain is incompatible, use nft»), поэтому правила ищутся через `nft -a list chain ip nat PREROUTING` по `dport <rdpPort>` и удаляются по handle (nft разных версий показывает правило iptables то как `dnat to IP:port`, то как `xt target "DNAT"`, комментарий не видно). Ставятся и проверяются правила через `iptables -I/-C` — это работает и на такой цепочке.

**Восстановление** (`reconcileVms`, раз в минуту): RDP-правило неподключённой VM снимается всегда — `netfilter-persistent save` мог сохранить его и вернуть после перезагрузки хоста. `ip link set master`, свои мосты и правила iptables не переживают перезагрузку docker-хоста — у подключённых VM мост (по `lanVlan`), сабинтерфейс и RDP-правило возвращаются, у неподключённых VLAN в мосту паркуется, осиротевшие мосты `ndsr-lan*` удаляются. Связки сохраняются в `vm_attachments.json`, поэтому переживают и рестарт бэкенда.

**UI**: в «My Booked Devices» кнопка **Test VMs** (бирюзовая, со счётчиком), в ячейке Device строки `VM: <имя> (<IP>)`. Диалог: подключённые к устройству VM (IP в LAN роутера, адрес RDP `172.16.78.254:<rdpPort>`, пользователь, пароль — всё с копированием, «Download .rdp», «Renew DHCP», Detach) и остальные (Attach / Move here / «in use by …»). Пароль в `.rdp` не кладётся (mstsc его не примет открытым текстом). Логин и пароль приходят только владельцу (`vm:getAccess`), в `vm:list` их нет.

**Подготовка (один раз):**

1. **ESXi** — VM на том же хосте и vSwitch `Public_int`, что и docker-хост (на `Trunk`). На каждую VM своя port group с VLAN плюс общая mgmt, по SSH на ESXi:
   ```sh
   esxcli network vswitch standard portgroup add -p vm1-lan -v Public_int
   esxcli network vswitch standard portgroup set -p vm1-lan --vlan-id 3001
   esxcli network vswitch standard portgroup add -p vm-mgmt -v Public_int
   esxcli network vswitch standard portgroup set -p vm-mgmt --vlan-id 3100
   ```
   (или в веб-интерфейсе ESXi: Networking → Port groups → Add). VLAN 30xx/3100 не должны использоваться на коммутаторах стенда. Promiscuous и forged transmits на `Trunk` уже включены — без них не работали бы CFK. VM на другом ESXi — только если эти VLAN проведены tagged по коммутаторам до uplink'а docker-хоста.
2. **Windows VM** (Pro/Enterprise — Home не принимает RDP): две сетевые карты — Network adapter 1 → `vmN-lan` (своя на каждую VM), Network adapter 2 → `vm-mgmt` (общая). Обе port group — на том же vSwitch, что `Trunk`; сами VM на `Trunk` не вешаются. В VM от администратора:
   ```powershell
   powershell -ExecutionPolicy Bypass -File Prepare-NdsrTestVm.ps1 `
     -LanMac <MAC adapter 1> -MgmtMac <MAC adapter 2> -MgmtIp 10.10.31.11 `
     -VmId vm1 -Vlan 3001 -RdpPort 33001
   ```
   Скрипт `ndsr-deploy/windows/Prepare-NdsrTestVm.ps1`: переименует карты в **LAN** (DHCP, имя — `-LanName`) и **Mgmt** (статический IP, без шлюза), включит RDP только на Mgmt, поставит сторожа LAN, создаст пользователя-администратора (`-UserName`; пароль спросит, только ASCII), отключит сон и напечатает запись для `vms.json` (с `lanMac`). Интернет для подготовки не нужен. На уже подготовленной VM — только сторож: `Prepare-NdsrTestVm.ps1 -WatchdogOnly -LanName <имя адаптера LAN>`.
3. **docker-хост**: `ansible-playbook -i inventory/inventory.ini setupDockerHost.yml --tags vm_mgmt` — **только с тегом**: остальные задачи роли содержат данные старого стенда (мосты `kn2610`… на VLAN 19xx, DNAT для старых CFK) и добавили бы лишние правила. Задачи: VLAN `vmmgmt` (10.10.31.1/24, netplan `60-ndsr-vm-mgmt.yaml`), FORWARD 3389 из `internet` в `vmmgmt`, MASQUERADE в `vmmgmt` (Windows видит RDP с адреса хоста — маршруты к сетям инженеров в VM не нужны).
4. **Пул** (при загрузке проверяется: пропущенные поля, повтор `id`/`vlan`/`mgmtIp`/`rdpPort` — запись пропускается с сообщением `❌ vms.json[N] … пропущена: …` в логе; битый JSON отключает только VM): `vms.json` (образец — `ndsr-app/api/vms.example.json`; поля `id, name, os, vlan, mgmtIp, rdpPort, rdpUser, rdpPassword, lanNic` (`testNic` — прежнее имя), **`lanMac`** (MAC адаптера LAN — без него адрес VM в портале не показывается)) → в проде `ndsr-state/vms.json` (вручную или из `roles/NDSR-APP-Compose-role-UP/files/vms.json`, он в .gitignore) → `device:reloadConfigs`.

**Ручная настройка docker-хоста без Ansible** (для проверки; адресация mgmt статическая: хост 10.10.31.1, VM — 10.10.31.11, .12, … без шлюза):

```sh
# 1. VLAN управления сразу (без netplan apply на живом хосте) ...
TRUNK=$(ip -br link | awk '$1 ~ /^vlan[0-9]+@/ {split($1,a,"@"); print a[2]; exit}')   # имя trunk в системе (не «int»)
sudo ip link add link $TRUNK name vmmgmt type vlan id 3100
sudo ip addr add 10.10.31.1/24 dev vmmgmt
sudo ip link set vmmgmt up
# ... и чтобы пережил перезагрузку
sudo tee /etc/netplan/60-ndsr-vm-mgmt.yaml >/dev/null <<'EOF'
network:
  version: 2
  vlans:
    vmmgmt:
      id: 3100
      link: int
      addresses: [10.10.31.1/24]
      dhcp4: false
      dhcp6: false
EOF
sudo chmod 600 /etc/netplan/60-ndsr-vm-mgmt.yaml
sudo netplan generate          # только проверка синтаксиса, без apply
# 2. RDP из сети инженеров в mgmt + ответы от VM на адрес хоста
sudo iptables -I FORWARD 1 -i internet -o vmmgmt -p tcp --dport 3389 -j ACCEPT
sudo iptables -I FORWARD 1 -i vmmgmt -o internet -m state --state ESTABLISHED,RELATED -j ACCEPT
# браузерный RDP: guacd (сеть приложения, мост br-<id> 10.10.18.0/24) → VM
sudo iptables -I FORWARD 1 -i <мост сети приложения> -o vmmgmt -p tcp --dport 3389 -j ACCEPT
sudo iptables -I FORWARD 1 -i vmmgmt -o <мост сети приложения> -m state --state ESTABLISHED,RELATED -j ACCEPT
sudo iptables -t nat -A POSTROUTING -o vmmgmt -j MASQUERADE
sudo netfilter-persistent save
# Если правила хоста грузятся из своего nft-файла с `flush ruleset` (как на
# проде: ~/new_with_rivals_nft_rules.rules), эти правила должны быть и в нём —
# иначе после его применения/перезагрузки RDP к VM пропадёт. Динамические
# DNAT ndsr-vm-* в файл не нужны: reconcileVms восстанавливает их сам.
# 3. проверка (когда VM запущена и подготовлена скриптом)
ping -c2 10.10.31.11; nc -vz 10.10.31.11 3389
```

**Отладка** (на docker-хосте):

| Что | Команда |
|---|---|
| в каком мосту VLAN VM | `ip -o link show dev ndsr-vm3001` (ищем `master kn2610` / `master ndsr-lan4080`) |
| есть ли VLAN LAN устройства на хосте | `ip -d -o link show type vlan \| grep 'id 4080'` |
| что вообще в мосту роутера | `bridge link show master kn2610` |
| RDP-правила VM | `iptables -t nat -S PREROUTING \| grep ndsr-vm` |
| состояние портала | `ndsr-state/vm_attachments.json` |
| доступ к Windows | с хоста `ssh <rdpUser>@<mgmtIp> ipconfig` |

В логе бэкенда: `🖥️ VM <id> → device <d> (bridge <br>) by <ip>`, `🖥️ VM <id>: test NIC got <ip>`, `🖥️ VM <id> detached … (<причина>)`, `🔧 VM <id>: restoring …`, `⚠️ VM <id>: DHCP renew in guest failed`.

**RDP в браузере (Guacamole).** Кнопка **Open in browser** в диалоге открывает окно `rdp.html` (отдельная страница Vite, `src/rdp/main.js`, `guacamole-common-js`):

```
браузер ── WebSocket /guacamole/ (nginx) ──► бэкенд guacamole-lite :GUAC_WS_PORT (3006)
                                                │  токен AES-256-CBC (ключ случайный на процесс)
                                                ▼
                                   guacd (контейнер ndsr-guacd, 10.10.19.251:4822) ── RDP ──► mgmt-IP VM:3389
```

- `vm:getRdpToken` выдаёт токен только владельцу VM; живёт `GUAC_TOKEN_TTL_MS` (60 с), при открытии соединения (`processConnectionSettings`) повторно проверяется, что VM всё ещё подключена этим пользователем. Логин и пароль Windows — внутри токена, в браузер не попадают. Токен передаётся в `#hash` окна и сразу убирается из адресной строки; «Reconnect» берёт новый.
- WebSocket guacamole-lite — на отдельном порту, а не на HTTP-сервере socket.io: `ws` с опцией `server` отклоняет апгрейды на чужие пути и сломал бы socket.io.
- Окно: размер сессии = размер окна (`resize-method: display-update`, при изменении окна — `sendSize`); если сервер размер не поменял — картинка уменьшается под окно. Ctrl+Alt+Del — кнопкой; вставка из буфера — Ctrl+V в окне; текст из буфера VM копируется в локальный (если браузер разрешит).
- Пароль Windows для браузерного RDP должен быть **ASCII** (guacamole-lite расшифровывает токен как ASCII).
- Выключатель — `GUACD_HOST` (роль: `browser_rdp_enabled`). Пусто → WebSocket не стартует, `vm:getAccess` отдаёт `browserRdp:false`, кнопки нет, guacd и `location /guacamole/` не рендерятся. RDP-клиент работает в обоих режимах.
- Локальная разработка: браузерный RDP работает только там, где guacd видит mgmt-сеть VM (10.10.31.0/24) — то есть на стенде. С машины разработчика проверять RDP-клиентом (`172.16.78.254:<rdpPort>`) или поднять guacd локально (`docker run -d -p 4822:4822 guacamole/guacd:1.5.5`, `GUACD_HOST=127.0.0.1`, `VITE_GUAC_WS_URL=ws://<адрес машины>:3006`) при наличии маршрута до mgmt-сети.
- Проверено локально: guacd 1.5.5 + xrdp-контейнер вместо Windows — рабочий стол, мышь, клавиатура, смена размера; рендер роли в обоих режимах, `nginx -t`. На Windows и на стенде — ещё нет.
- Отладка: `docker logs ndsr-guacd` (`Creating new client for protocol "rdp"`, ошибки RDP/NLA), лог бэкенда `🖥️ Browser RDP to VM <id> by <ip>`; пустой экран при «Connected» — смотреть консоль браузера окна RDP.

Ещё не сделано: откат VM к чистому снапшоту при детаче (нужен доступ к ESXi).

---

## 9. Конфигурация и данные

### 9.1 Переменные бэкенда (`ndsr-app/api/.env`)

Шаблон — `ndsr-app/api/.env.example` (актуален).

| Группа | Переменные |
|---|---|
| Сервер | `WS_PORT`, `UPLOAD_DIR`, `STATUS_CHECK_INTERVAL` (с, ≥5), `STATUS_CHECK_TIMEOUT` (с) |
| Пути к данным | `DEVICES_CONFIG_PATH`, `WAN_TYPES_CONFIG_PATH`, `USER_CONFIG_PATH`, `BADGES_CONFIG_PATH`, `CURRENT_MODES_PATH`, `BOOKINGS_PATH`, `MWS_LINKS_PATH`, `VMS_CONFIG_PATH`, `VM_ATTACHMENTS_PATH` (относительные пути считаются от cwd) |
| Тестовые VM | `VM_TRUNK_IFACE` (trunk-NIC хоста; по умолчанию определяется сам — родитель существующих VLAN-интерфейсов: в netplan стенда `int` — только id netplan, в системе имя ядра вроде `ens160`), `VM_RDP_IN_IFACE` (`internet`), `VM_RDP_PUBLIC_HOST` (адрес docker-хоста для RDP-клиента), `GUACD_HOST`/`GUACD_PORT`/`GUAC_WS_PORT`/`GUAC_TOKEN_TTL_MS` (RDP в браузере; пустой `GUACD_HOST` — выключено), `VM_RDP_SOURCE_OVERRIDE` (только dev: адрес-источник для RDP-правила вместо IP браузера — dev-бэкенд видит браузер по локальной сети, а mstsc приходит на хост с VPN-адреса) |
| Логи | `LOG_DIR` (пусто — только stdout), `LOG_MAX_SIZE_MB`, `LOG_MAX_FILES` |
| Клиенты | `TRUST_PROXY_HEADERS`, `VPN_IP_PREFIXES` |
| Отладка | `DEBUG_BOOKINGS`, `DEBUG_PASSWORDS`, `DEBUG_WAN` |
| Оборудование | `MOXA_IPS`, `JEROME_IPS`, `JEROME_PORT`, `VES_IP/PORT/LOGIN/PASSWORD`, `SWITCH_IPs`, `SWITCH_WAN_IPs`, `SWITCH_LOGIN/PASSWORD` |
| Docker host | `SSH_HOST`, `SSH_PORT`, `SSH_USERNAME`, `SSH_PRIVATE_KEY_PATH` |

### 9.2 Файлы данных (`ndsr-app/api/`)

| Файл | Содержимое | Кто пишет |
|---|---|---|
| `devices.json` | массив устройств (поля ниже). В проде — `ndsr-state/devices.json`, деплой его не перезаписывает | add/remove, set/clear пароля, factory reset (пароль, `currentWanType`), сохранение WAN |
| `wan_types.json` | каталог `{type, vlanId}` + шаблоны команд коммутатора (`setting`: `onVlanPVID`, `offVlanPVID`, `onVlanFixPort`, `offVlanFixPort`, `VlanTrunking`) | вручную |
| `users.json` | `[{ip, name}]`. В проде — `ndsr-state/users.json` | user:* |
| `bookings.json` | `{deviceId: {bookedBy, expiresAt, accessPassword, passwordInvalidated}}` | бронирование |
| `current_modes.json` | `{deviceId: {mode, routerId, timestamp}}` (создаётся при первой записи) | смена режима, MWS, factory reset (удаляет запись) |
| `mws_links.json` | `{extenderId: {routerId, routerIp, extenderIp, timestamp}}` (создаётся при первой записи) | настройка/снятие пробросов MWS |
| `vms.json` | пул тестовых VM с учётками Windows (в git нет, образец `vms.example.json`) | вручную |
| `vm_attachments.json` | связки VM → устройство | атач/детач VM |
| `badge.json` | не используется (формат не совпадает с кодом) | — |
| `usbSwitch.json` | не используется (USB-свитч не реализован) | — |

Поля `devices.json`:

- **идентификация**: `id` (он же порт проброса для MWS), `hwId` (= имя CFK-контейнера), `type`, `shortName`, `country`, `macAddress`, `serialNumber`, `servicetag`;
- **доступ**: `ip`, `checkUrl`, `URL`, `vncUrl`, `checkDeviceMode`;
- **консоль**: `consoleID`, `consolePort`;
- **питание**: `jeromeID`, `jeromeClass` (`old`/`new`), `rebootPort`, `resetPort`;
- **коммутация**: `vlanLocal`, `switchID`, `switchPortLan`, `switchIDWan`, `switchPortWan`, `switchIDWanSecondary` (свич второго WAN-порта, пусто = тот же), `switchPortWanSecondary`, `port` (для MWS-trunk роутера);
- **прочее**: `currentWanType`, `tftpInterfaceName`, `dslPort`, `hwType`, `rivals` (`true` — устройство конкурента, см. 8.11);
- **пароль**: `devicePassword` — намеренно виден всем пользователям портала (см. 8.3).

Чего не хватает сейчас:

- `macAddress` обязателен для MWS и поиска IP экстендера;
- без `dslPort` сброс DSL всегда падает;
- без `port` у роутера trunk для MWS настраивается только на одном порту.

### 9.3 Переменные фронта (`ndsr-app/.env`)

`VITE_WS_HOST`, `VITE_API_URL`, `VITE_PROJECT_NAME`, `VITE_IPERF_SERVER`, `VITE_IPERF_SERVER_PUBLIC` (`VITE_CONSOLE_TIMER` не используется).

---

## 10. Деплой и эксплуатация

### 10.1 Первичный деплой

1. **Terraform** (`ndsr-deploy/Terraform`, подробно — `README.md`).
   - Нужны terraform 1.7.x и ovftool 4.4.3 в PATH.
   - Переменные `esxi_username`, `esxi_password`, `admin`, `password`, `ssh` — в `*.tfvars`, они в gitignore.
   - `terraform init && terraform plan && terraform apply -auto-approve` — создаёт portgroup `Trunk` и VM с cloud-init.
2. **Вручную**: включить **promiscuous mode** (и, скорее всего, forged transmits) на portgroup `Trunk`. Без этого контейнеры docker-net-dhcp не получают трафик. Повторный `terraform apply` может снова выключить эти режимы.
3. **Ansible** (`ndsr-deploy/Ansible`, `-i inventory/inventory.ini`), строго в таком порядке:
   1. `ndsrCompose.yml`:
      - плагин docker-net-dhcp;
      - загрузка образа CFK с datastore ESXi;
      - `docker compose` проекта `ndsr` (создаёт сеть `ndsr_default`);
      - юнит `docker_start.service` (поднимает `KN-*` после ребута);
      - iptables и маршруты в CFK.
   2. `setupDockerHost.yml` — resolv.conf, FORWARD/MASQUERADE/DNAT на хосте, `netfilter-persistent save`.
   3. `ndsrSetupContainers.yaml` — внутри каждого CFK: пакеты, `monitorGw`, `monitorRoute`.
   4. `ndsrAppCompose.yml` (роль `NDSR-APP-Compose-role-UP`, подробно — её `README.md`):
      - **адресов стенда в роли нет** — стенды разворачивают разные команды. Inventory команды: `cp -r inventory/example inventory/<стенд>` (каталог в .gitignore), адрес docker-хоста — в `hosts.ini`, IP контейнеров и оборудования — в `group_vars/all/stand.yml`, пароли — в `group_vars/all/vault.yml` (ansible-vault); запуск `-i inventory/<стенд>/hosts.ini`;
      - один раз на машине с Ansible: `ansible-galaxy collection install -r requirements.yml`;
      - роль проверяет секреты, SSH-ключ и обязательные переменные **до** изменений на хосте;
      - копирует `ndsr-app/` архивом без `node_modules`, `.env`, ключей и локального состояния; каталог на хосте пересоздаётся;
      - `devices.json`/`users.json` живут в `ndsr-state/` и не перезаписываются (разово — `-e devices_json_overwrite=true`); при первом деплое по новой схеме рабочая копия переносится туда автоматически;
      - рендерит env бэкенда (`env_file`, в образ не попадает), `.env` фронта, nginx, Dockerfile'ы, compose;
      - **пересобирает образы при каждом деплое** и запускает compose проекта `ndsr-app` (`restart: unless-stopped`).

### 10.2 Команды

На docker-хосте:

```sh
# стек CFK
docker compose -p ndsr -f ndsr.yml --env-file VARS.env up -d | restart | down
# приложение (с пересборкой) — то же делает роль
docker compose -p ndsr-app -f ndsr-app.yml --env-file VARS-APP.env up -d --build
# логи
docker logs -f ndsr-app-back        # бэкенд — основной источник диагностики
docker logs -f ndsr-app-front
docker logs -f KN-2610              # конкретный CFK
# firewall
iptables -t nat -S
nft list table ip nat
systemctl status docker_start
```

Быстрый up/stop/restart стека CFK из Ansible: `ansible-playbook -i inventory/inventory.ini ndsrComposeQuickUpDownRestart.yml`.

Внутри CFK (`docker exec -it KN-xxxx bash`):

```sh
systemctl status monitorGw monitorRoute
tail -f /var/log/changeContainersIp.log /var/log/monitorRoutes.log
iptables -t nat -S PREROUTING
ip addr; ip route
```

Локальная разработка:

```sh
cd ndsr-app/api && npm run server-dev     # бэкенд
cd ndsr-app && npm run dev                # фронт на :8080
# smoke-тест бэкенда без запуска сервера:
cd ndsr-app/api && node --env-file=.env -e "import('./src/socketHandler.js')"
```

### 10.3 Что не переживает рестарт бэкенда

Сбрасывается при рестарте:

- суточные пароли (генерируются заново);
- флаг cron (выключается);
- кэши статусов, питания и прошивок;
- чат;

Сохраняется: брони (`bookings.json`), режимы (`current_modes.json`), связки MWS с IP пробросов (`mws_links.json`), devices.json. `device:reloadConfigs` `mws_links.json` не чистит — запись удаляется только при снятии пробросов.

Что примонтировано в контейнер бэкенда (каталоги вне `ndsr-app/`, который деплой пересоздаёт):

| Хост | Контейнер | Что |
|---|---|---|
| `/home/<admin>/ndsr-state` | `/app/state` | `devices.json`, `users.json`, `bookings.json`, `current_modes.json`, `mws_links.json` |
| `/home/<admin>/ndsr-uploads` | `/app/uploads` | файлы FileManager |
| `/home/<admin>/ndsr-logs` | `/app/logs` | `backend.log` (если задан `log_host_dir`) |
| `/home/<admin>/ndsr-secrets/id_ed25519` | `/root/.ssh/id_ed25519` (ro) | SSH-ключ к docker-хосту |

`wan_types.json` и `badge.json` берутся из образа. Пересоздание контейнеров ничего из состояния не теряет.

---

## 11. Диагностика: симптом → где смотреть

| Симптом | Вероятная причина | Где смотреть |
|---|---|---|
| Пустая таблица устройств | фронт не подключился к socket.io: неверный `VITE_WS_HOST` (вшит при сборке), бэкенд упал или порт не тот | DevTools → Network → WS; `docker logs ndsr-app-back`; `WS_PORT` |
| Бэкенд падает сразу при старте | битый или отсутствующий JSON (devices, wan_types, users, badge) — они читаются синхронно | первые строки лога; пути `*_CONFIG_PATH`; запуск не из `ndsr-app/api/` |
| Все устройства offline (0) | проброс или маршрут до `checkUrl`, CFK лежат | `curl -I <checkUrl>` с хоста бэкенда; `docker ps`; `monitorGw` в CFK |
| Одно устройство offline | Keenetic выключен (реле), CFK не получил DHCP (192.168.1.254 = fallback), VLAN/мост | `device:getPowerStatus`; `docker exec KN-x ip addr`; лог `changeContainersIp.log` |
| Статусы перестали обновляться до F5 | `ProgressModal` снимает все слушатели `device:status` (`socket.off` без handler) | перезагрузка страницы; баг в 12.2 |
| «Устройство забронировано другим» / кнопки неактивны | IP клиента изменился (VPN, NAT, прокси), `TRUST_PROXY_HEADERS` | `CLIENT_IP` на фронте и `bookedBy` в `bookings.json` |
| Все пользователи «один и тот же» (чужие брони видны как свои), в логе у всех один `ip` | клиенты идут через nginx, а `TRUST_PROXY_HEADERS=false` → все видны как IP nginx `10.10.19.254` | `ndsr-app-backend.env`; лог `🔗 Client connected` (`trustedProxy`) |
| После деплоя работает старый код | образ не пересобран (роль до октября 2026 собирала образ только если его нет) | `docker images` (время создания); `docker compose … up -d --build` |
| После деплоя пропали пароли / WAN / добавленные устройства | `devices.json` перезаписан версией из репозитория (`devices_json_overwrite=true` или старая роль) | `ndsr-state/devices.json`; восстановить из бэкапа |
| «Authentication failed» / cooldown | неверный пароль; после рестарта потерян yesterday-пароль; после factory reset пароль сброшен | лог `🔑`/`🛡`; подождать 60 с; задать пароль через `device:setPassword` |
| Устройство в сети, но портал/веб висят по тайм-ауту, лечится только перезагрузкой | Keenetic заблокировал адрес CFK-контейнера после неудачных входов (5.2, «Защита от блокировки») | лог: `❌ Ошибка аутентификации … (неверных паролей за окно: N/3)`, `Login to … paused`, затем `⏰ Таймаут проверки статуса`; перезагрузить устройство; проверить `devicePassword` в `/app/state/devices.json` (файл `/app/devices.json` в старых образах — неиспользуемая копия) |
| Reboot → `deviceStatus:'timeout'` | устройство не поднялось за 120 с, неверный `rebootPort`/`jeromeID`, `jeromeClass` | лог `[POWER]`; проверить реле вручную; для old-класса см. 12.3 |
| Питание/reset не работают | Jerome/PowerHub недоступен, неверный индекс в `JEROME_IPS` | лог `Failed to … after 3 attempts`; `telnet <jerome> 23/2424` |
| «WAN applied partially» | один из WAN-свичей недоступен / сбой на нём; в таблице — фактическое состояние | текст предупреждения или лог `❌ WAN <id>: …`; `nc -vz <switch> 23` |
| WAN не переключается | telnet к WAN-коммутатору, `switchIDWan`/`switchPortWan` (`switchIDWanSecondary`/`switchPortWanSecondary` для второго порта), номер свича за пределами `SWITCH_WAN_IPs`, VLAN нет в `wan_types.json` | лог changeWanType (`🔌 WAN-коммутатор <ip>: …`); `telnet <switch>`; `show vlan` |
| Сброс DSL всегда ошибка | у устройства нет `dslPort` | devices.json |
| Смена режима висит | ожидание MWS-кандидата может длиться десятки минут; экстендер не видит роутер (VLAN) | лог changeModeType; `show mws candidate` на роутере; события `device:modeChangeProgress` |
| Режим показан неверно | устаревший localStorage `deviceCurrentMode`; `current_modes.json` из старого деплоя | очистить localStorage; `current_modes.json`; «обновить режим» в UI |
| Веб экстендера через роутер не открывается | нет DNAT на хосте/в контейнере; IP экстендера не найден (нет `macAddress`); экстендер сменил IP по DHCP | `mws_links.json` (`extenderIp`); `nft list table ip nat`; `docker exec <router hwId> iptables -t nat -S` |
| После отключения/сброса экстендер всё ещё в сети роутера или веб открывается через роутер | связка разобрана не до конца (см. 8.5, «Что создаёт подключение…») | пройти по таблице в 8.5; повторить отключение или factory reset экстендера — снятие идемпотентно |
| Сброс подключённого экстендера: «Router is booked by another user» | роутер в чужой брони, связку трогать нельзя | дождаться освобождения роутера или попросить владельца отключить экстендер |
| Сброс подключённого экстендера падает сразу, устройство не сбрасывается | не удалось откатить коммутатор или NAT (telnet к LAN-коммутатору, SSH к docker-хосту) | лог `reconfigureSwitchWithLocalVlan` / `removeIptablesRulesOnly`; `SWITCH_*`, `SSH_*` |
| TFTP IP не показывается | нет SSH до docker-хоста (`SSH_*`, ключ), нет `tftpInterfaceName`, контейнер `hwId` не найден | лог `DockerManager`; `ssh <SSH_HOST> docker exec <hwId> ip addr` |
| Загрузка файлов не работает | неверный `VITE_API_URL`, нет прав на `UPLOAD_DIR`, лимит 100 МБ / расширение | Network → `/api/upload`; лог `📁` |
| Консоль не открывается | cooldown 60 с, блокировщик попапов, MOXA/webtelnet недоступны | sessionStorage `consoleCooldown_<id>`; `docker logs ndsr-webtelnet-console` |
| Утром сброшены устройства / выключен WAN | включён cron (04:00: отключение экстендеров, затем WAN off + reset незабронированных) | переключатель cron в шапке |
| Утром часть устройств не сброшена | забронированы; роутер связки забронирован; отключение экстендера не удалось (тогда пропущены и экстендер, и роутер) | лог `Skipping …`, `Failed to disconnect extender …` (8.10) |
| Ошибка «Not available for rival devices.» | у устройства `rivals: true` — операция запрещена намеренно (8.11) | `devices.json`; если устройство наше — убрать поле и `device:reloadConfigs` |
| VM подключена, адреса в портале нет | смотреть причину в диалоге VM. «Not in the router DHCP table»: сторож в Windows не отработал (`Get-ScheduledTask NDSR-LanWatchdog`, журнал `C:\ProgramData\NDSR\lan-watchdog.log`) или VLAN LAN устройства не доходит до docker-хоста; «lanMac is not set» — дописать MAC в `vms.json` | `ip -o link show dev ndsr-vm<vlan>`; `bridge link show master <мост>`; лог `🖥️ VM … LAN address` |
| «vlanLocal is not set» / «Bridge … not found» | у устройства нет `vlanLocal`, или указан несуществующий `bridge` | `devices.json`; `ip -br link show type bridge` |
| RDP к VM не подключается | правило только для IP владельца (сменился VPN-IP), нет FORWARD/MASQUERADE для `vmmgmt`, RDP/брандмауэр в Windows | `iptables -t nat -S PREROUTING \| grep ndsr-vm`; `setupDockerHost.yml`; с хоста `nc -vz <mgmtIp> 3389` |
| Окно RDP в браузере: «RDP token expired» / «Connection configuration error» | токен старше 60 с или VM отключили | «Reconnect» в окне; VM должна быть подключена тобой |
| Окно RDP: ошибка сразу после «Connecting…» | guacd недоступен / не доходит до mgmt-IP VM, NLA/пароль (не ASCII) | `docker logs ndsr-guacd`; с хоста `nc -vz <mgmtIp> 3389` |
| Нет иконок | нет доступа к CDN jsdelivr | — |

---

## 12. Известные проблемы

Список для планирования работ, по состоянию кода на октябрь 2026.

### 12.1 Бэкенд

- CRUD устройств и пользователей, `reloadConfigs` и `cron:toggle` доступны всем (TODO S1).
- Сброс **роутера**, к которому подключены экстендеры, не снимает их связки: VLAN и NAT экстендеров остаются, а сами экстендеры могут быть в чужой брони. Нужно решить: запрещать такой сброс или отвязывать свободные/свои экстендеры.
- `vlan-trunking`, который подключение ставит на портах экстендера и роутера во VLAN роутера, не снимает ни один путь отключения (порт экстендера при этом `forbidden`). Нужна команда отмены для коммутатора.
- `fullDisconnect` начинает с команды на самом экстендере: если она падает, коммутатор и NAT не трогаются (8.5). `disconnectAndChangeToRouter` распознаёт «нормальный ребут» по тексту ошибки (`timeout`) — хрупко.
- Две проверки статуса дают разные коды (0 и 500) на одну и ту же ошибку.
- `device:currentFW`: разные формы payload при init и live. `device:getCurrentFW` требует `password`, хотя умеет подбирать кандидатов.
- Переход `extender` → `extender_connect` отправляет тот же режим и выходит раньше, MWS не подключается (`changeModeType.js`).
- `dockerManager.js`:
  - `getExtenderIpFromArp` не существует → DNAT на неверный IP;
  - `this.ssh` undefined в нескольких методах.
- `nftablesManager`: `insert … position 0`, скорее всего, падает, и правило добавляется в конец.
- `sshManager` не считает ненулевой exit code ошибкой; к команде добавляется двойной `sudo`.
- `disconnectManager`:
  - `fetch` с опцией `timeout` (Node её игнорирует) может зависнуть;
  - при одинаковом коммутаторе отправляется `pvid` без значения.
- Telnet-prompt `/.*[# ]/i` срабатывает слишком рано.
- Регэксп статуса канала PowerHub без границы слова (порт 1 может совпасть с 10).
- `rebootDevice` old-класса: `waitfor` инвертированы. Проверить на железе.
- `connectToMws` записывает дефолтные `vlanLocal` в объект в памяти; следующий `saveConfig` сохранит их на диск.
- Мёртвый код:
  - `readConfig.js`, `changeDslType.js`, `networkManager.js`;
  - `checkDeviceId.js`, `devPower.js` (выполняют код при импорте);
  - `test.js`, `testScript.js`;
  - badge-хелперы, `usbSwitch.json`, `savePasswordToFile`.

Закрыто в октябре 2026 (для истории): S7 — бронь для режима/MWS/WAN; ack и ошибки пробросов в `device:mwsConnected`; второй `rebootDevice` с объектом вместо id при MWS disconnect; `disconnectExtender` больше не удаляет режим до операции; сетевая ошибка при смене режима не включает cooldown; `ipDiscovery` импортирует `getDeviceById`; IP пробросов переживают рестарт (`mwsLinks`); ночной сброс чистит пароль, режим, кэш прошивки и `currentWanType`.

### 12.2 Фронтенд

- `socket.off(event)` без handler в `ProgressModal` и `PrimeDeviceModal` снимает слушатели сторов. После первого прогресс-диалога перестают обновляться статусы и режимы. `socket.onAny` и `device:modeChangeResult` накапливаются при каждом открытии.
- События без обработчика на сервере: `device:forceStatusCheckAll`, `device:updateShortName`, `password:generate`, `device:cancelOperation`. Слушатели `device:operationError` и `device:firmwareUpdated` мёртвые — сервер эти события не шлёт.
- MWS для AP без аппаратного переключателя в `DeviceDataTable.handleModalSave` показывает успех, ничего не отправляя на сервер.
- `listenForMwsUpdates` нигде не вызывается → `device:mwsStatusUpdated` игнорируется.
- Хук «определить режим после брони» не регистрируется (есть только `removeEventListener`).
- `GlobalProgressDialog` ищет устройства в всегда пустом `allDevices`; отладочный блок (`showDebug = true`) виден пользователям.
- AppHeader ↔ App: `toggle-day` не привязан, `change-password` никогда не эмитится.
- Хардкод:
  - VNC-пароль;
  - статические IP-настройки для IPoE Public;
  - `login:'admin'`;
  - RCI-batch инициализации.
- Мёртвые компоненты `CountdownTimer.vue`, `DeviceExtensions.vue`; лишние зависимости (bootstrap-vue, element-plus и т.п.).

### 12.3 Деплой

- Роль приложения проверена прогоном в песочнице (октябрь 2026): сборка трёх образов, запуск, SPA, socket.io и загрузка файлов через nginx, повторный деплой, миграция `devices.json`. На реальном стенде после переделки ещё не запускалась.
- При подключении к стенду **с самого docker-хоста** бэкенд видит IP шлюза docker-моста, а не клиента — для пользователей через VPN это не проявляется.
- webtelnet собирается из GitHub (`flask-remote-terminal`) на Python 3.6 (EOL): без интернета на docker-хосте образ не соберётся.
- На проде (US05Docker05) сборка из сети `docker0` зависает на больших загрузках (`npm ci` → «Exit handler never called!», в т.ч. с кодом 0 → потом «vite: not found»), с хоста те же загрузки идут нормально. Трафик `docker0` принимается в `DOCKER-FORWARD` раньше правила `tcp option maxseg size set rt mtu` (MSS-clamping). Обход — сборка с сетью хоста: `docker build --network host …`, в compose-шаблоне роли `build.network: host`. Образы на `node:20-alpine` (vite 7 требует Node ≥ 20.19), во фронте после `npm ci` — `test -x node_modules/.bin/vite`.
- Ошибки в данных:
  - `VARS.env`: `DUO=KN-2210` против 2110, дубль порта 1811;
  - inventory: `KN-2111` против `KN-2211`;
  - SSH-forward 1936–1938 без `:22`.
- Скрипты:
  - `monitorRoutes.sh` — старая версия с синтаксической ошибкой крутится в бесконечном цикле, новая никогда не запускается;
  - `tcpmss.sh` — `exit0`;
  - `setupIptablesCFK.sh:20` — вывод `docker exec` подаётся в iptables хоста.
- DNAT внутри CFK пишут три источника: `setupIptablesCFK.sh`, `changeContainersIp.sh` и `DockerManager`. Они могут перетирать правила друг друга.
- Promisc на `Trunk` включается только вручную.
- Роли CFK (`NDSR-Compose-role-UP`: `ndsr.yml`, `VARS.env`; `SetupContainers`; `SetupDockerHost` кроме задач `vm_mgmt`; `scripts/`) и `inventory/inventory.ini` пока содержат адреса и набор моделей одного стенда. Цель — генерировать их из списка устройств в inventory стенда, как уже сделано для роли приложения.
- Данные хоста в репозитории устарели: `Terraform/metadata.tpl` и `roles/SetupDockerHost/vars` описывают старый стенд (мосты `kn2610`… на VLAN 1904–1916), а на сервере — `kn2710`…`nc10131` на 4064–4080 и `riv101`…`riv104`. Полный прогон `setupDockerHost.yml` на живом стенде не делать (для VM — `--tags vm_mgmt`).
- Terraform:
  - remote-exec идёт на порт 22, а cloud-init переносит sshd на 9678;
  - имена хоста расходятся в разных местах.

---

## 13. Безопасность

Требует внимания:

- **В git закоммичены секреты**, хотя они и указаны в `.gitignore`: трекинг от этого не снимается. Это:
  - `ndsr-app/api/id_ed25519` (приватный SSH-ключ);
  - `ndsr-app/api/.env`, `ndsr-app/.env`;
  - `inventory.ini` (sudo/ssh-пароли);
  - vars и шаблоны Ansible-роли приложения (логин/пароль VES и коммутаторов);
  - `ndsr-app/TEST.js` (креды telnet).

  Нужно: `git rm --cached`, ротация ключа и паролей, при необходимости чистка истории. Также закоммичены `node_modules` (794 файла).
- **Пароли устройств видны всем пользователям портала — это сделано намеренно**: `devicePassword`, `accessPassword` и суточные пароли приходят каждому клиенту (`device:list`, `device:bookingUpdated`, `device:passwordUpdated`, `DAILY_PASSWORDS`). Портал общий для техподдержки и разработчиков: если следующий пользователь не знает пароль, выставленный предыдущим, устройство пришлось бы сбрасывать, а это потеря времени. Пароли ротируются, поэтому угрозой не считаются. Секретами здесь являются ключи и учётки инфраструктуры (SSH-ключ, коммутаторы, VES, ESXi, Ansible).
- Аутентификации нет нигде. Пользователь определяется по IP, CORS `*`, REST загрузки и удаления файлов открыт.
- Уже сделано (метки `🔒 S*` в коде):
  - SSRF-фильтр в `device:init`;
  - защита от path traversal и санитизация имён файлов;
  - лимит размера socket-сообщений;
  - пароли не пишутся в логи;
  - destructive-операции требуют брони.
