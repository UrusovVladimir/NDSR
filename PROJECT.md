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
| MOXA | Серийная консоль устройства: окно консоли портала (`console.html`, 8.15) — бэкенд ходит telnet на `CONSOLE_HOSTS`; запасной путь — webtelnet. |

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
| ~~ndsr-webtelnet-console~~ | — | — | Удалён со стендов 77 и 78 2026-10-28 (контейнеры, сервисы в `ndsr-app.yml`, DNAT/accept 5005/5007 в правилах nft, образы): окно консоли — в портале (8.15). На 196 не ставился |
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
| Docker host | `SSH_HOST/PORT/USERNAME/SSH_PRIVATE_KEY_PATH` | `container` или `hwId` (= имя CFK-контейнера, `containerNameOf`) | SSH (ssh2), `sudo docker exec`, nft/iptables |

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
| `POST /api/upload` | Загрузка файлов (поле `files`, до 50 шт, до 100 МБ, только `.bin`/`.txt`), имя санитизируется; кто загрузил (IP клиента) и когда — в `uploads_meta.json` |
| `GET /api/files` | Список файлов в `UPLOAD_DIR`; у каждого `uploadedBy` (IP, `null` — загружен до учёта или положен в каталог вручную) |
| `GET /api/files/:filename` | Скачивание (защита от path traversal) |
| `DELETE /api/files/:filename` | Удаление (и записи о загрузившем) |

IP клиента для HTTP и для socket.io определяется одинаково — `src/utils/clientIp.js` (`TRUST_PROXY_HEADERS` → `X-Real-IP` от nginx). Метаданные загрузок — `src/state/uploadsMeta.js`, файл `UPLOADS_META_PATH` (по умолчанию `uploads_meta.json` рядом с `devices.json`, на стендах это каталог состояния), не в `UPLOAD_DIR`: тот отдаётся по TFTP и показывается списком. Записи файлов, убранных из каталога мимо портала, удаляются при показе списка. Файловый менеджер показывает имя загрузившего по `users.json` (`getUserName`), для неизвестных — «—».

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
- `mwsForwardService.js` — `reconcileMwsForwards`: возвращает пропавшие пробросы подключённых экстендеров по `mws_links.json` (8.5, «Восстановление пробросов»).

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
   - устройство предлагает обе схемы, а фаза 1 ndw4 отвергнута (401 без `X-NDM-Data`) — вход по ndw2 со свежим challenge. Так ведёт себя Atlas SE 5.02 в режиме участника MWS: ndw4 не пускает при верном пароле, ndw2 пускает (78, 1714, 29.10.2026 — в логе было бесконечное `ndw4: device not ready`, версия прошивки не читалась).

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
- проверка прошивки (`device:checkMultipleFirmwares` и `device:getCurrentFW`) — одна на устройство (`firmware.js` `checkFirmwareOnce` + `checkOneFirmware`): параллельные запросы из разных вкладок ждут общий результат, свежий (30 с) отдаётся без входа;
- пароль, присланный браузером в запросе проверки (его копия `devicePassword`, пароль брони или суточный «на удачу»), используется, только если у бэкенда нет своего `devicePassword`: копия в браузере бывает устаревшей (так 9.10 в 16:27 на 3812 ушли 2 неверных пароля сразу после рестарта).

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
- IP, на которые поставлены MWS-пробросы, хранятся в `state/mwsLinks.js` (`mws_links.json`) и переживают рестарт: снятие правил берёт IP оттуда, а не ищет экстендер заново по DHCP; по ним же `reconcileMwsForwards` возвращает стёртые правила (8.5).
- `nftablesManager` ищет правила по `tcp dport <порт>( |$)` и `dnat to <ip>(:| |$)` — без совпадения по префиксу (раньше `10.10.20.2` задевал и `10.10.20.21`).
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
| `device:restoreSwitchAndReset` | `{deviceId, routerId}` → как reboot | «Restore Switch & Reset»: откат свича/NAT к выбранному роутеру (связка могла не записаться), затем factory reset (`factoryResetDevice(…, {revertRouterId})`) | ✔ + роутер свободен или свой |
| `device:resetConfig` | `deviceId` → как reboot | factory reset (8.10) | ✔; для подключённого экстендера — связка (отключение) |
| `device:resetDslLine` | `deviceId` → `{status}` | сброс DSL | ✔ |
| `device:init` | `{url, body, deviceId}` → `{success, data}` | прокси RCI-batch на устройство (Skip Wizard); SSRF-фильтр по хостам из devices.json | ✔ |
| `device:getPassword` / `setPassword` / `clearPassword` | `deviceId` / `{deviceId, password}` | пароль устройства в devices.json; `clearPassword` — кнопка **Forget Password** в окне «Change Device Password» («мои брони», карандаш у пароля): удаляет `devicePassword` из конфига, пароль брони → `passwordInvalidated` — статус «Unknown» (на устройстве пароль не меняется) | ✔ |
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
| `device:getConsoleUrl` | `deviceId` → `{success, builtin: true}` или `{success, url}` | окно консоли портала / ссылка на webtelnet (кэш 5 мин) | — |
| `console:open` | `{deviceId, replay?}` → `{success, deviceName, target, devicePassword}` | окно консоли (`console.html`): подписка на общее подключение к порту консоли; затем `console:data {deviceId, data: Buffer}`, `console:note`, `console:end` | бронь |
| `console:input` / `console:close` | `{deviceId, data, binary?}` / `{deviceId}` | ввод в консоль / закрыть окно | бронь |
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
| `useConsoleStore` | Окно консоли: `console.html` (builtin) или попап webtelnet с cooldown 60 с (sessionStorage); `isLegacyConsoleOpen` — открыт webtelnet |
| `useCronStore` | Переключатель ночных задач |
| `useChatStore` | Чат, упоминания, онлайн-пользователи |
| `useClipboardStore`, `useEscapeStore` | Буфер обмена (fallback для не-HTTPS), обработка Esc |

### 7.3 Компоненты

```
App.vue
├─ AppHeader — часы (МСК), суточный пароль, переключатель cron, FileManager
├─ DeviceDataTable — таблица устройств (не мои): вкладки Our Devices / Rival Devices в шапке, поиск, модалки, сохранение WAN/MWS; у каждого устройства под hwId — «Current Mode» (если известен) и «Connected to» у extender_connect (режимы всех устройств сервер шлёт при подключении и при каждом изменении)
│   ├─ SharedVmsStatus — в строке счётчиков (online/offline/total) «N/M VMs free»; по клику список VM: свободна / кто занял, к какому устройству, сколько осталось (до booking.expiresAt устройства — VM отключается вместе с бронью). Данные: vm:list (всем) + брони из deviceStore; строка счётчиков — группы `.count-item` с переносом (на телефоне не шире экрана); панель закрывается при прокрутке страницы (кроме прокрутки своего списка); нет VM — скрыт
│   ├─ BookedDevicesTable — «мои устройства»: основное рабочее место (питание, reset, режимы,
│   │                        консоль, VNC, веб, Skip Wizard, продление, релиз, FW Check All;
│   │                        меню по клику на Device дублирует Actions, в т.ч. кнопку VMs)
│   │   ├─ Actions: в строке частые — консоль, сброс (у extender_connect вместо него Restore
│   │   │  switch & reset: сначала no mws member у контроллера, затем свич/NAT и сброс — обычный
│   │   │  Reset откатывал бы связку, только если она записана в портале), веб, снятие брони и
│   │   │  «More ▾» (бейдж — число подключённых VM). В «More» (PrimeVue Menu, actionsMenuItems)
│   │   │  по группам: Access (питание on/off/reboot, LAN VNC, Test VMs), Configuration (Change mode, Restore
│   │   │  у extender без связки, Skip Wizard), Network (MWS connect, Router LAN IP, Reset DSL).
│   │   │  Условия доступности — прежние
│   │   ├─ Restore Switch & Reset (pi-undo: в строке — у extender_connect, в «More» — у extender,
│   │   │  в меню по клику на Device — всегда): окно с выбором роутера (по умолчанию — из записанной
│   │   │  связки) → device:restoreSwitchAndReset — порт свича в свой VLAN, снятие пробросов, сброс
│   │   └─ массовые reboot / reset / release: чекбоксы в первой колонке (в заголовке — выбрать
│   │      все свои брони, конкурентов тоже) → в шапке «Selected: N · Reboot (N) · Reset (N) ·
│   │      Release (N) · ×»; Reboot/Reset считают и запускают только не конкурентов.
│   │      Release — одним device:releaseMultiple (как Release All): бэкенд проверяет бронь и
│   │      разбирает схемы «LAN как WAN»; не снятые — в тосте с причиной. Reboot/Reset →
│   │      подтверждение со списком. Каждое устройство — обычная одиночная операция
│   │      (useDeviceActionsStore.rebootDevice / resetConfig: строка в окне прогресса, вывод
│   │      консоли, тост), запуск с шагом 6 с (reboot) / 13 с (reset), чтобы telnet-сессии
│   │      к Jerome/PowerHub не пересекались (сброс держит кнопку ~10 с); занятые операцией
│   │      пропускаются. Бэкенд не менялся — права проверяет как для одиночных
│   ├─ BookingStatus — бронирование/продление одного устройства; длительность — BookingDurationDialog
│   ├─ BookingDurationDialog — выбор длительности (слайдер 10 мин … 7 дней + быстрые кнопки), общий для одиночной и массовой брони
│   ├─ массовая бронь (в DeviceDataTable): клик по строке свободного устройства отмечает его — вместо статуса галочка
│   │   (клики по кнопкам/переключателям строки не считаются), панель «Selected: N · Book selected · Clear» внизу,
│   │   бронь — тем же device:book по очереди; неудачные остаются отмеченными, Esc сбрасывает выбор
│   ├─ BookedByOther — чужая бронь: имя пользователя + «сколько осталось» (из `booking.expiresAt`, общие часы `composables/useNow.js`, тик 30 с; подсказка — время окончания)
│   ├─ PrimeDeviceModal — выбор WAN / MWS-подключение / FAQ
│   ├─ ChangeModeModal — смена режима; для Extender + Connect — выбор пароля экстендера
│   │                    (как у роутера / свой); отладочный раздел «Show Debug Info» убран
│   ├─ ProgressModal — пошаговый прогресс (управляется событиями сервера); для смены режима
│   │                  и MWS — блоки «Console output» устройства и роутера, к которому его
│   │                  подключают (operationData.routerId) — ConsoleOutputBlock, useConsoleLogStore,
│   │                  только свои брони; раскрытый — окно шире и само не закрывается;
│   │                  при ошибке окно само не закрывается — текст ошибки, закрывает пользователь
│   └─ ConsoleOutputBlock — общий раскрывающийся вывод консоли одного устройства
├─ GlobalProgressDialog — прогресс операций из useDeviceActionsStore (прогресс имитированный)
├─ SidebarContent — счётчики, iPerf, reload configs, добавить/удалить устройство и пользователя
└─ ChatWidget (components/chat/*)
```

**Прокрутка под модалками.** `blockScroll` у большинства Dialog не задан или `false`, поэтому блокировка глобальная (`assets/main.css`): пока на странице есть маска модального окна (`.p-dialog-mask.p-component-overlay`), `html:has(...) body` — `overflow: hidden` (именно на `body`: на `html` прокрутка `body` отвязывалась от окна — страница под модалкой прыгала наверх и на 15px вбок; ширина держится `scrollbar-gutter: stable` на `html`); у маски, содержимого окна и `pre` в окне — `overscroll-behavior: contain` (прокрутка у края не уходит на страницу).

**Кеш HTML.** nginx фронта отдаёт `*.html` (`index.html`, `rdp.html`, SPA-fallback) с `Cache-Control: no-cache` (`location ~ \.html$` в `nginx.conf.j2`): после обновления портала браузер сразу берёт новую страницу и новые ассеты (их имена с хешем кешируются как обычно). Без этого после деплоя открывалась старая `rdp.html` («ничего не поменялось»). На стендах конфиг — смонтированный `nginx.conf.j2` (77: `~/nginx.conf.j2`, 78: `/home/uvs/NDSR_PROJECT/nginx.conf.j2`), применяется `docker exec ndsr-app-front nginx -s reload`.

**Закрытие модальных окон кликом снаружи** (`src/utils/dialogOutsideClose.js`, ставится в `main.js` для всех `Dialog`): окно закрывается, только если и нажатие, и отпускание мыши были на затемнении (`.p-dialog-mask`) — выделение текста, начатое в окне и отпущенное снаружи, окно не закрывает (стандартный `dismissableMask` PrimeVue срабатывает на `click` и закрывал бы; его у окон не включать). Закрытие идёт нажатием крестика окна: окна с `:closable="false"` (прогресс, обязательное подтверждение, «идёт операция») кликом снаружи не закрываются, обработчики закрытия срабатывают как обычно.

**Модальные окна и прокрутка.** Модальный `Dialog` PrimeVue 3 вешает на `body` класс `p-overflow-hidden`, а `src/assets/main.css` делает его `overflow: hidden` — страница под модалкой не прокручивается. Чтобы страница не «прыгала» при пропадании полосы прокрутки, у `html` стоит `scrollbar-gutter: stable`. Не возвращать `body.p-overflow-hidden { overflow-y: scroll }` — раньше именно оно разрешало прокрутку под модалками.

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

Если у устройства `hwType` = `true/yes/1` (`utils/deviceFlags.isApSwitchOn` — одинаково на бэкенде и фронте, `src/utils/deviceFlags.js`), у него **аппаратный переключатель режима**: программная смена режима запрещена. Тип не важен: на 77 так помечены KN-4010, KN-3411 (`type: AP`) и KN-4310 Atlas SE (`type: router`). `hwType` значит только «переключатель есть»; **положение** — отдельно:

- **A — Router**: устройство работает роутером; к другому роутеру по MWS его не подключить — сначала переключатель в B (устройство перезагрузится extender'ом).
- **B — Access point**: устройство extender; к роутеру — MWS Connect (`device:mwsConnected`), без смены режима. После ребута всегда в `extender`.

Положение (`services/switchPosition.js`, состояние `state/switchPositions.js` → `switch_positions.json` рядом с `devices.json`) узнаётся у самого устройства: `/rci/show/system/mode` → `active` (`router` → A, иначе B). Запрос с авторизацией, поэтому постоянно не опрашивается (лок после неверных паролей) — запоминается при каждом определении режима: `device:getCurrentMode` (кнопка Refresh mode, окно Change Mode), проверка перед MWS Connect, успешный MWS Connect. Рассылается всем `device:switchPosition { deviceId, position: 'router'|'ap', at }`, в `device:list` — поле `switchPosition`. Заодно правится записанный режим (`current_modes.json`), если противоречит положению: A → `router`, B → `extender` (`device:modeUpdated`, `source: 'switch_position'`); активную связку `extender_connect` не трогаем. Так у KN-4310 на 77 висел `extender` при переключателе в A.

- MWS-помощники RCI — `actions/mwsRci.js` (разбор кандидатов/участников, `assertRciOk`, `findMwsMember`, `releaseMwsMember`). `releaseLinkInfrastructure` (сброс подключённого экстендера, Restore Switch & Reset) и `finishApDisconnect` тоже делают `releaseFromController` — не обязательно, сбой не останавливает.
- **В интерфейсе**: под hwId (основная таблица и «мои брони») — тег: **HW switch: A · Router** (оранжевый), **HW switch: B · AP** (синий) или **HW switch** (серый, положение ещё не определялось), с подсказкой. Отдельной строкой: строка имени `nowrap` + `overflow: hidden` обрезала тег у длинных имён. Кнопки Change Mode нет, вместо неё **MWS Connect** (`canMwsConnectType`: `type: AP` или переключатель); в положении A кнопка не открывает окно, а объясняет «переключите в B» (`SWITCH_A_HINT`). `ChangeModeModal` действий не даёт, текст зависит от положения. Стор режимов не навязывает `extender` устройству в положении A.
- **Сервер**: `device:mwsConnected connect` для такого устройства сначала спрашивает положение (не удалось — берёт последнее известное) и в A отказывает до любых изменений (свитч, пробросы) с текстом «…position A (Router)… move the switch to position B…». Текст ошибки MWS уходит в окно прогресса (`sendMwsProgress(…, 'error', message)` → `ProgressModal.failOperation`). `device:changeMode` отказывает всегда; отказы до старта (переключатель, нет брони) идут и в ack, и событием `device:modeChangeResult` — окно прогресса закрывается с ошибкой (раньше висело на первом шаге).
- До октября 2026 фронт сравнивал `hwType === 'true'`, а в конфигах `yes` — такие устройства шли обычной сменой режима и упирались в отказ сервера; положение A не учитывалось вовсе.

Какой путь выбирает фронт (`PrimeDeviceModal.saveChanges`):

| Устройство | Подключение / отключение |
|---|---|
| `hwType` = true/yes/1 (переключатель) | `device:mwsConnected` `connect` / `disconnect` |
| остальные | `device:changeMode` `extender_connect` / `extender_disconnect` |

**Режим на фронте** (`useModeStore.currentMode`): источник — сервер (`currentModes`, рассылка `device:modeUpdated` всем). Снятие брони режим не стирает (устройство физически в нём осталось; раньше после новой брони было «Unknown» до F5). `device:getCurrentMode` спрашивает устройство, но принятый контроллером экстендер сам про связку не знает (его `show/mws` пуст, ответ «extender») — сервер в этом случае отдаёт записанную `extender_connect` с `routerId`, кнопка обновления режима роутер не теряет (раньше «Extender (Connected)» превращалось в «Extender»).

**`device:changeMode`** (`socket/handlers/mode.js` → `actions/changeModeType.js`):

1. `requireLinkAccess`, guard аппаратного переключателя, guard cooldown.
2. **Проба авторизации до любых изменений**: `GET /rci/show/system/mode` по кандидатам.
   - не подошёл ни один пароль → cooldown 60 с и отказ;
   - сетевая ошибка → «Device is unreachable», отказ **без** cooldown.
3. Для `extender_connect` — пароль роутера (`resolveRouterPassword`, 8.3) и **пароль экстендера**: `extenderPasswordMode` `'router'` (по умолчанию — проверенный пароль роутера) или `'custom'` + `extenderPassword` (≥ 4 символов; выбор в `ChangeModeModal` → «Extender Password»).
4. Сразу ack `{async:true}`. Дальше прогресс идёт событиями `device:modeChangeProgress`. Фронт (`useModeStore.changeMode`) ждёт итог `device:modeChangeResult` без жёсткого срока: сторож тишины 15 мин перезапускается на каждом `device:modeChangeProgress` устройства (прежний таймер 180 с от старта давал «Request timeout» посреди нормального отключения экстендера — оно идёт до ~6 мин).
5. Если `action:'wan_off'` — выключить WAN на коммутаторе.
6. `changeSystemMode`: устройство **уже extender**, а нужно подключить к роутеру — смена режима и ребут пропускаются, подключение/ожидание/пробросы выполняются (раньше ранний return «уже в режиме» записывал `extender_connect` без VLAN роутера и пробросов). Ответ `POST /rci/system/mode` проверяется (`assertRciOk`). Для `extender_connect` сначала, пока устройство ещё роутер, ставит ему пароль экстендера (`POST /rci/` `user password` + `system configuration save`, как Skip Wizard; проверка входа с новым паролем; портал запоминает его — `rememberDevicePassword`: конфиг, бронь, `device:passwordUpdated`). Устройство в заводском состоянии (на смену пароля отвечает `EULA not accepted`, пароля нет) — пароль не ставится (контроллер захватит его и задаст свой), перед сменой режима принимаются EULA и DPN (`acceptEulaDpn`: `eula accept`, `dpn accept`, `system configuration save`), затем режим. Если «EULA not accepted» ответила сама смена режима — то же принятие и повтор (77, 1713, 29.10.2026). Пароль нужен устройству со **своим** паролем. Зачем: MWS-контроллер (роутер) заходит на экстендер со **своим** паролем — при другом пароле кандидат висит `DISCONNECTED` с `rci: error … access unauthorized`. Затем `POST /rci/system/mode` → через 2 с `POST /rci/system/reboot`.
7. Для экстендера с `routerId`:
   - `connectToMws` — VLAN роутера на LAN-порт экстендера;
   - `show/mws/candidate` отдаёт **объект** (`{}` / `{ candidate: [...] | {...} }`), а не массив — разбирает `normalizeCandidates` (до октября 2026 код ждал массив и кандидатов не видел никогда, работала только запасная проверка по ARP);
   - **уже принят** (пароль совпал с роутером) — из кандидатов экстендер пропадает и числится в `show/mws/member` (массив `{cid, model, mac, …}`; в конфиге роутера — `mws member <mac>`): это считается найденным и подключённым (раньше ждали кандидата до таймаута, пробросы не делались);
   - **подпорка «access unauthorized»** (один раз за подключение): кандидат `DISCONNECTED` с `access unauthorized` → пробросы через роутер (как в конце подключения) → на экстендер по `checkUrl` с паролем, бывшим на нём при переводе (затем исходный, затем пароль роутера): `POST /rci/` `[{parse:'user admin no password'},{parse:'system configuration save'}]` → на роутере `[{parse:'mws revisit <mac>'}]` → ждём нормальный статус дальше. RCI `parse` выполняет текст CLI (проверено `show version` на 78, прошивка 5.01). Не вышло — причина в итоговой ошибке;
   - ожидание экстендера в `show/mws/candidate` / `show/ip/neighbor` (нет на прошивке — 404 → `show/ip/arp`) — **до десятков минут**; ищется по `macAddress` экстендера. Пустой `macAddress` — до любых изменений (до WAN off) MAC читается с экстендера (`/rci/show/interface/Bridge0`, это MAC его LAN) и сохраняется в `devices.json` (`ensureExtenderMac`); не прочитался — подключение сразу отклоняется. Раньше пустой MAC давал ~26 минут ожидания и ошибку;
   - проброс портов (`DockerManager.setupPortForwarding`, пишет `mwsLinks`; контейнер роутера — `containerNameOf`: поле `container` или hwId).
   - **сбой любого шага после переключения свича** — откат: порт экстендера → его `vlanLocal`, снятие пробросов и записи `mwsLinks` (`reconfigureSwitchWithLocalVlan` + `removeIptablesRulesOnly`); устройство остаётся в extender — вернуть в router или сбросить. Раньше отката не было: экстендер оставался в VLAN роутера, а связка в `currentModes` не записывалась — сброс её не откатывал, и после сброса в сети роутера появлялся второй 192.168.1.1 (так было на 77 20.10.2026 с 2312 и 4110 при NC-1013). Factory reset теперь откатывает и незавершённую связку из `mwsLinks`.
8. Ожидание загрузки → `currentModes.set` (только при успехе) → `waitForOnline` → события `device:modeUpdated`, `device:mwsStatusUpdated` и `device:modeChangeResult`.

**Отключение обычного экстендера** (`extender_disconnect` → `disconnectAndChangeToRouter`; `device:disconnectExtender` → сразу шаг 2):

1. WAN off (`changeWanType(null)`).
2. `DisconnectManager.fullDisconnect` (`utils/disconnectManager.js`):
   0. `releaseFromController`: экстендер в `show/mws/member` роутера → `no mws member <mac>` + `system configuration save` (пароль роутера — `resolveRouterPassword`). Участник MWS отвечает на смену режима `system mode: execute blocked in MWS member mode` (HTTP 200!);
   1. команда смены режима на самом экстендере — ответ проверяется (`assertRciOk`): «blocked in MWS member mode» — повтор каждые 5 с до ~1 мин (экстендер выходит из MWS не сразу), дальше ошибка **до** переключения свича и пробросов (раньше отказ считался успехом: ребут, свич, а устройство оставалось extender);
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

**Восстановление пробросов** (`services/mwsForwardService.js`, `reconcileMwsForwards`; запуск из `bootstrap.js` — через 30 с после старта, затем раз в 2 минуты). Правило хоста живёт только в ядре: `nft -f <файл>` с `flush ruleset` (выкатка/пересоздание бэкенда на 77/78, правка nft-файла) его стирает, и порт `<extenderId>` уходит на статическое правило из файла — в собственный CFK экстендера, где веба нет (так было на 78 28.10.2026 с 2312 → 1012). Правило в CFK роутера пропадает при пересоздании контейнера. Ещё случай: экстендер не успел получить адрес в DHCP роутера за время подключения (его захватывают в MWS, он перезагружается) — раньше правило в контейнере ставилось на запасной адрес (IP CFK роутера или самого экстендера, 10.10.x) и так и оставалось (78, 28.10.2026: 4410 → `10.10.20.19:80`, а экстендер получил 192.168.1.95). Теперь такие адреса не используются (`isRealExtenderIp` в `state/mwsLinks.js`): связка пишется с `extenderIp: null`, правила в контейнере нет, адрес находит сверка. Сверка:
- берёт записи `mws_links.json`, у которых `current_modes.json` = `extender_connect` к тому же `routerId`; остальные пропускает (ничего не удаляет — лишнее снимает отключение);
- хост: ищет в `nft list chain ip nat PREROUTING` строку `tcp dport <id> … dnat to <routerIp>[:порт]` (подходит и ручное правило с `iifname`), нет — `manageHostFirewall(…,'setup')` (вставка в начало цепочки, впереди статического);
- адрес экстендера: `IpDiscoveryService.getExtenderIpFromRouter` (DHCP bindings роутера по MAC, затем ARP) — при `extenderIp: null` каждый проход, при известном — раз в 10 минут. Сначала кэшированной сессией портала; без неё — `resolveRouterPassword` (конфиг → бронь владельца роутера → daily) не чаще раза в 10 минут на роутер, чтобы не сработала блокировка входа после неверных паролей. Адрес сменился — правило на старый адрес (и на IP CFK роутера от прежних версий) снимается, связка перезаписывается, правило на новый ставится в том же проходе;
- контейнер роутера: ищет в `iptables -t nat -S PREROUTING` `--dport <id> … --to-destination <extenderIp>:80`, нет — `manageContainerFirewall(…,'setup')`; контейнер не запущен — пропуск;
- ставит правило, только если его нет **два прохода подряд** и запись связки ещё есть: отключение сначала снимает правила, потом удаляет запись — сверка не должна вернуть правило в этом промежутке. Поэтому после `nft -f` проброс возвращается за 2–4 минуты;
- в логе бэкенда: `🔧 MWS <ext> → <router>: restoring host forward …` / `restoring forward in <container> …` / `extender IP <старый> → <новый>`, адрес ещё не найден — `⏳ MWS … extender IP still unknown`, ошибки — `❌ MWS forward reconcile: …`.

AP-устройства (`type: AP` + `hwType` — `isApSwitchOn`: 'yes'/'true'/'1') при MWS Connect ждут адрес дольше (`waitForAPInDHCP`). Раньше `mwsConnectionManager` сравнивал `hwType === 'true'`, а на 78 у AP `'yes'` — они ждали как обычные устройства 5×3 с.

**Ручная проверка — кнопка «Check port forwarding»** (🔍 в строке подключённого экстендера в «My Booked Devices» и More → Network). Событие `mws:checkForward { deviceId }` (`socket/handlers/mode.js`, права как у отключения: экстендер в своей брони, роутер не в чужой) → `checkMwsForward` в `mwsForwardService.js`:
1. связка: `current_modes` = `extender_connect` + `routerId`; у экстендера нужен `macAddress`;
2. адрес по MAC: участники MWS контроллера (`/rci/show/mws/member`, если там есть ip) → DHCP bindings / ARP роутера → ARP изнутри CFK роутера (при промахе — пинг /24 LAN-интерфейса контейнера и повтор);
3. адрес — в `mws_links.json` (снятие правил и сверка работают с ним);
4. правило хоста (`dport <id>` → CFK роутера) — нет, ставится;
5. правило в CFK роутера: правила этого порта на другие адреса снимаются, `→ <ip>:80` — ставится, если нет;
6. доступность: `curl` из CFK роутера на `http://<ip>/` и запрос `checkUrl` с бэкенда; успех — бэкенд сразу шлёт `device:status`.
Ответ `{ ok, ip, reachable, steps: [{ step, ok, detail }] }` — окно с шагами (Run again / Open web). Пока идёт ручная проверка, сверка этот экстендер пропускает.

Автопроверка: `autoCheckOfflineExtenders` (`bootstrap.js`, раз в 30 с) — связка жива, экстендер не отвечает (`deviceStatusCache` ≠ 200) дольше 1 мин → `checkMwsForward(id, { auto: true })`, не чаще раза в 5 мин на экстендер. В режиме auto адрес и правила пишутся, только если запись связки ещё есть (проверка перед сохранением и перед каждым правилом) — отключение, снявшее связку посреди проверки, не получит её обратно. Починила — `mws:forwardAutoFixed { deviceId, ip, owner, steps }` (тост владельцу брони) и `device:status`. Интервалы — `AUTO_OFFLINE_MS` / `AUTO_RETRY_MS`.

Резервирование адреса на роутере — только по кнопке пользователя в окне проверки («Reserve <ip> on router» / «Remove reservation»): схеме может быть нужно, чтобы точка получала новый адрес. `mws:dhcpReservation { deviceId, action: 'set'|'clear' }` → RCI `ip dhcp host <mac> <ip>` / `no ip dhcp host <mac>` + `system configuration save`; текущее состояние — `GET /rci/ip/dhcp/host` (в ответе проверки — `reservation`). Синтаксис проверен на 196 (1121) 29.10.2026.

Адрес экстендера в строке «Connected to: NC-1013 (Giga) · 192.168.1.95» (My Booked Devices и Our Devices): `state/mwsLinks` при `saveMwsLink`/`dropMwsLink` шлёт `mws:linkIp { deviceId, ip }`, начальное состояние — `mws:linkIps` (`useModeStore.getExtenderIp`).

Подсветка: экстендер `extender_connect` в своей брони не отвечает (статус ≠ 200) дольше 90 с и над ним нет операции — кнопка 🔍 пульсирует, один тост на эпизод («Check port forwarding or device availability…»). Порог — `FORWARD_ALERT_MS` в `BookedDevicesTable.vue`.

Что править при изменениях: формат правил — `manageHostFirewall` / `manageContainerFirewall` (`utils/dockerManager.js`) и, если поменялся вид строки, регулярки `hostHasRule` / `containerHasRule` в `mwsForwardService.js`; новые поля связки — `state/mwsLinks.js` (`saveMwsLink` в `setupPortForwarding` и `MWSConnectionManager.setupMWSConnection`); частота — `bootstrap.js`, интервалы поиска адреса — `IP_REFRESH_MS` / `PASSWORD_RETRY_MS` в `mwsForwardService.js`; какие адреса не считаются адресом экстендера — `isRealExtenderIp`. Ручные правила для портов экстендеров в nft-файл класть не нужно.

Согласованное состояние — либо всё из таблицы есть (подключено), либо ничего нет. Все операции снятия **идемпотентны** (правила сначала ищутся, удаляются только найденные; `pvid`/`forbidden` просто выставляются заново), поэтому при «полуразобранной» связке безопасно повторить отключение или сделать factory reset экстендера.

### 8.6 Тип WAN

1. UI: `WanTypeDisplay` → `PrimeDeviceModal` → `DeviceDataTable.handleWanSave` → `device:wanTypes:save`.
2. Сервер валидирует dual WAN, переключает VLAN на WAN-коммутаторе (5.4), сохраняет `device.currentWanType` в devices.json и рассылает `device:wanTypeUpdated`.
3. Фронт ждёт ack 30 с (dual WAN — 60 с).
4. **Второй WAN-порт** (`switchPortWanSecondary`, может быть на другом свиче) при одиночном WAN гасится (4094) — только если он мог быть включён: прошлый тип Dual WAN или тип неизвестен (`changeWanType(…, { secondaryKnownOff })`, решает `applyWanChange` по сохранённому типу). Прошлый тип одиночный — второй свич не трогается (раньше гасился всегда, и недоступность второго свича ломала, например, IPoE NAT → PPPoE). Отключение экстендера (`changeModeType`) по-прежнему гасит оба порта.

### 8.7 Прошивки и конфиги по TFTP

Бэкенд **не заливает** файлы на устройство сам. Процесс:

1. FileManager загружает `.bin`/`.txt` на сервер (`POST /api/upload` → `UPLOAD_DIR`).
2. DeviceSelector: инженер выбирает своё онлайн-устройство. UI показывает IP TFTP-сервера (`tftp:getInterfaceIp`: `docker exec <hwId> ip addr show <tftpInterfaceName>` по SSH).
3. Устройство тихо перезагружается (или включается питание), открывается консоль MOXA.
4. Инженер вручную прошивает файл из загрузчика по TFTP.

Версия прошивки: `device:getCurrentFW` (авторизация → `show/version` → `release`) или пакетно `device:checkMultipleFirmwares`.

### 8.8 Консоль, VNC, веб

- **Консоль** — `device:getConsoleUrl`: если для устройства задан хост консоли (`CONSOLE_HOSTS`) и не `CONSOLE_WEB=webtelnet` → `{builtin: true}`, открывается окно портала `console.html` (8.15); иначе `http://<MOXA>/remote/telnet/telnet/<consolePort>` (webtelnet), попапом, после открытия cooldown 60 с. Доступна только владельцу брони.
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
3. VLAN-интерфейс VM на транке (`findVlanIf`): если там уже есть интерфейс с этим VID (заведён под VM заранее, например `vlan4051` из netplan на стенде 172.16.78.254) — берётся он, иначе `ip link add link <trunk> name ndsr-vm<vlan VM> type vlan id <vlan VM>` (второй интерфейс с тем же VID ядро не создаст) → `ip link set <интерфейс> master <мост>`. Неподключённая VM паркуется вне мостов (`nomaster`) — в т.ч. заранее заведённый интерфейс уходит из своего моста (на 78: `riv405x` остаются пустыми);
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
   **Ubuntu VM** (24.04–26.04 Desktop, GNOME): те же две карты; в VM от root:
   ```sh
   sudo ./prepare-ndsr-test-vm.sh --lan-mac <MAC adapter 1> --mgmt-mac <MAC adapter 2> \
     --mgmt-ip 10.10.41.10 --user user --vm-id vm9 --vlan 4059 --rdp-port 40059
   ```
   Скрипт `ndsr-deploy/linux/prepare-ndsr-test-vm.sh`: профили NetworkManager `ndsr-lan` (DHCP) и `ndsr-mgmt` (статический, `never-default`), RDP — **удалённый вход GNOME** (`gnome-remote-desktop`, системный демон: `grdctl --system rdp` — TLS-сертификат в `/var/lib/gnome-remote-desktop/.local/share/gnome-remote-desktop/`, учётка = rdpUser/rdpPassword, порт 3389 без port negotiation; RDP → экран входа GDM → свой сеанс Wayland). **xrdp не годится**: с GNOME 49 (Ubuntu 25.10/26.04) сеанса X11 нет — xrdp поднимает Xorg, gnome-session выходит через секунду («Window manager … exited quickly», так было на vm9 78, Ubuntu 26.04), ufw — входящий 3389 только на Mgmt, сторож LAN — systemd-служба `ndsr-lan-watchdog` (как Windows-задача: нет адреса / шлюз не отвечает 2× / сменился MAC шлюза → `nmcli connection down/up ndsr-lan`, ≤1/мин; журнал `journalctl -t ndsr-lan-watchdog`), пользователь в sudo, сон замаскирован, автовход GDM выключен (GNOME не пускает одного пользователя одновременно на консоль и в RDP). `--watchdog-only --lan-if <if>` — только сторож. В конце печатает запись vms.json (`lanNic` = имя интерфейса, `lanMac`). Пользователям ничего ставить не нужно: mstsc / RDP из браузера. В портале по `os` (linux/ubuntu/…) — без кнопки Ctrl+Alt+Del в окне RDP и без подсказки «ipconfig in Windows».
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
- Окно: размер сессии = размер окна (`resize-method: display-update`, при изменении окна — `sendSize`); если сервер размер не поменял — картинка уменьшается под окно. Ctrl+Alt+Del — кнопкой; текст из буфера VM копируется в локальный (если браузер разрешит).
- **Буфер обмена → VM.** Портал по http: читать системный буфер браузер не даёт, а Ctrl+V перехватывает клавиатура Guacamole (событие `paste` не возникает) — простое Ctrl+V в окне в VM не доходит. Поэтому: `vm:getRdpToken` отдаёт ещё `devicePassword`/`deviceName` устройства, к которому подключена VM (`getEffectiveDevicePassword`, иначе пароль брони; только владельцу VM), — при подключении он сразу кладётся в буфер VM и повторно кнопкой **Device password → VM**; любой текст — поле в панели (вставить Ctrl+V или ввести → Enter/Send). Пока фокус в поле, клавиши в VM не уходят (`onkeydown` → `true`); клик по экрану возвращает клавиатуру в VM. Внутри VM — обычный Ctrl+V. Что ушло в буфер, видно сразу: плашка поверх экрана («✓ «фрагмент…» (N chars) is in the VM clipboard — press Ctrl+V inside the VM»; для пароля — имя устройства, не пароль) и зелёное поле с подсказкой на 6 с.
- Пароль Windows для браузерного RDP должен быть **ASCII** (guacamole-lite расшифровывает токен как ASCII).
- Выключатель — `GUACD_HOST` (роль: `browser_rdp_enabled`). Пусто → WebSocket не стартует, `vm:getAccess` отдаёт `browserRdp:false`, кнопки нет, guacd и `location /guacamole/` не рендерятся. RDP-клиент работает в обоих режимах.
- Локальная разработка: браузерный RDP работает только там, где guacd видит mgmt-сеть VM (10.10.31.0/24) — то есть на стенде. С машины разработчика проверять RDP-клиентом (`172.16.78.254:<rdpPort>`) или поднять guacd локально (`docker run -d -p 4822:4822 guacamole/guacd:1.6.0`, `GUACD_HOST=127.0.0.1`, `VITE_GUAC_WS_URL=ws://<адрес машины>:3006`) при наличии маршрута до mgmt-сети.
- **guacd — 1.6.0** (FreeRDP 3). 1.5.5 (FreeRDP 2) не договаривается с удалённым входом GNOME (`gnome-remote-desktop` 50, Ubuntu 26.04): «Server refused connection (wrong security type?)» при любом `security` (any/nla/tls/rdp), хотя Remmina (FreeRDP 3) входит. 1.6.0 проверен на 78 с vm9 (Ubuntu) и vm1 (Windows 10).
- Проверено локально: guacd 1.5.5 + xrdp-контейнер вместо Windows — рабочий стол, мышь, клавиатура, смена размера; рендер роли в обоих режимах, `nginx -t`. На Windows и на стенде — ещё нет.
- Отладка: `docker logs ndsr-guacd` (`Creating new client for protocol "rdp"`, ошибки RDP/NLA), лог бэкенда `🖥️ Browser RDP to VM <id> by <ip>`; пустой экран при «Connected» — смотреть консоль браузера окна RDP.

Ещё не сделано: откат VM к чистому снапшоту при детаче (нужен доступ к ESXi).

---

### 8.14 Вывод консоли при перезагрузке и сбросе

В окне прогресса (`GlobalProgressDialog`) у каждого перезагружаемого/сбрасываемого устройства — свёрнутый блок **Console output**; раскрытый — окно шире (~960px), лог прокручивается вниз (если не отмотать наверх); свёрнутый — окно прежнего размера. Пока вывод раскрыт, окно не закрывается само по окончании операции («Operation Finished», закрыть крестиком).

- Бэкенд `services/consoleCapture.js`: telnet `<хост консоли>:<consolePort>`, хост по `consoleID` из `CONSOLE_HOSTS` (через запятую, порядок как у `MOXA_IPS`; на 77 — `172.16.77.252,172.16.77.252`, на 78 — `172.16.78.252,172.16.78.253` — это `domain` в config.py контейнеров webtelnet). Подключение — общее с окном консоли портала (`services/consoleHub.js`, 8.15), текст очищается от ANSI, `\r` выкидывается целиком (консоли шлют и `\r\n`, и `\n\r`, и `\r\r\n` — прежняя замена `\r\n?→\n` давала пустую строку после каждой строки); блок вывода оформлен как окно консоли (шрифт, 13px, межстрочный 1.2, фон #1e1e1e), пачками раз в 250 мс событием `device:consoleLog` только запросившему сокету. Стоп: `device:consoleCapture:stop`, отключение браузера, лимит `CONSOLE_CAPTURE_MAX_MS` (6 мин), закрытие порта.
- `device:consoleCapture:start/stop` (`socket/handlers/consoleCapture.js`) — только владелец брони, не для конкурентов. Фронт (`useConsoleLogStore`) запрашивает захват в `executeDeviceAction` для `rebooting`/`resetting` и останавливает через 20 с после конца операции.
- **Порт консоли пускает одного клиента: последнее подключение выбивает предыдущее** (проверено на 78: из двух telnet-клиентов закрывается первый). Окно консоли портала и захват сидят на одном подключении и не мешают друг другу. Окно webtelnet держит своё: при открытом webtelnet захват не запрашивается (блок «in console window»); webtelnet, открытый во время захвата, забирает порт — захват завершается с пометкой.
- Не настроено (`CONSOLE_HOSTS` пуст / у устройства нет `consoleID`/`consolePort`) — блок «unavailable» с причиной. Массовые операции администратора и ночной сброс консоль не захватывают.

### 8.15 Окно консоли в портале (замена webtelnet)

Окно консоли — отдельная страница Vite `console.html` (`src/console/main.js`, xterm.js `@xterm/xterm` + `@xterm/addon-fit`), открывается `useConsoleStore` по `{builtin: true}` от `device:getConsoleUrl` (адрес `console.html?v=<время>#device=<id>`). Данные — через socket.io портала, без контейнеров webtelnet.

- **Бэкенд** `services/consoleHub.js`: на устройство одно TCP-подключение к `<хост из CONSOLE_HOSTS>:<consolePort>`, общее для всех окон консоли и захвата вывода (8.14); открывается первым подписчиком, закрывается с последним. Хвост вывода 64 КБ — новое окно сразу показывает последнее. Telnet: соглашаемся на ECHO/SGA/BINARY, остальное отклоняем; ввод — IAC удваивается, CR без BINARY → CR NUL.
- `socket/handlers/consoleTerminal.js`: `console:open/input/close`. Только владелец брони, не для конкурентов; бронь перепроверяется на каждый ввод и раз в 15 с — закончилась → `console:end` «booking ended». Отключение браузера / закрытие окна — отписка.
- **Окно**: Password (вводит пароль устройства, без Enter), Copy, Save log (.txt), Clear, Reconnect (после `console:end`). Копирование — выделение + Copy / Ctrl+C при выделении / Ctrl+Shift+C (через `execCommand`, по http `navigator.clipboard` нет); вставка — Ctrl+V / Ctrl+Shift+V; Ctrl+C без выделения уходит в консоль (^C). Обрыв socket.io — окно переподключается само, без повторной выдачи хвоста.
- Выбить подключение может только клиент не из портала (telnet напрямую, webtelnet) — окно покажет «console connection closed».
- Откат на webtelnet (`CONSOLE_WEB=webtelnet` / пустой `CONSOLE_HOSTS`) в коде остался, но с 2026-10-28 контейнеров webtelnet на стендах нет — он не откроется; `CONSOLE_HOSTS` должен покрывать все `consoleID`. Cooldown 60 с — только для webtelnet.
- **Почему заменили webtelnet** (контейнеры `ndsr-webtelnet-console_*`, flask-remote-terminal на Python 3.6 / Flask 1.1 / Flask-SocketIO 4): вывод опрашивался раз в 0,15 с (задержка на каждую клавишу, рывки при загрузке), на каждое окно — отдельный `telnet` в pty на dev-сервере Flask, `decode()` без потокового декодера ломался на разрезанных UTF-8 символах (`***AQUI WEB TERM ERR***`), адрес `…:5005/remote/telnet/telnet/<порт>` открывал консоль любого устройства без брони, хост консоли зашит в Dockerfile. Окно webtelnet и захват вывода при перезагрузке выбивали друг друга с порта.
- **Выкачено 2026-10-21** на 77 и 78 (`a53c136`); 2026-10-28 webtelnet со стендов удалён (копии `ndsr-app.yml.bak-*`, правил nft `*.bak-*`). `CONSOLE_HOSTS`: 77 — `172.16.77.252,172.16.77.252`; 78 — `172.16.78.252,172.16.78.253` (consoleID 1 — .252, consoleID 2 — .253, у NC-1013; было `172.16.78.252,,172.16.78.253`, из-за пустого второго NC-1013 открывался через webtelnet).

### 8.16 WAN из LAN другого роутера (схемы, цепочки)

Тип WAN **«Router LAN (another router)»** в окне WAN Settings (только для роутеров): WAN роутера-**потребителя** — LAN роутера-**источника**. Оба — брони пользователя, режим router, не конкуренты. Цепочки (A ← B ← C) разрешены, кольца — нет. Сервер — `services/lanWanService.js`, состояние — `state/lanWanLinks.js` (`lan_wan_links.json` рядом с `devices.json`, ключ — потребитель: `{ upstreamId, vlan, owner, lan: { original, applied } | null }`), события `lanWan:list/plan/apply/dismantle`, рассылка `lanWan:links`.

- **Окно** (`LanWanPanel` в `PrimeDeviceModal`): выбор источника (недоступны: extender, кольцо) → `lanWan:plan`: LAN обоих (`/rci/interface/Bridge0/ip/address`, пул `/rci/ip/dhcp/pool` с `bind: Bridge0`, обычно `_WEBADMIN`). Совпадают — у **потребителя** новая /24: «+1» (следующий свободный третий октет) или вручную; пул DHCP — те же хосты в новой сети. У потребителя с подключёнными экстендерами подсеть не меняется (отказ).
- **Адрес роутера в контейнере**: после смены подсети портал пишет его в `/etc/ndsr/router-ip` (8.17) — контейнер нового образа держит проброс на нём и при выключенном у роутера DHCP; при разборке возвращается прежний `routerLanIp` (обычно авто).
- **Смена подсети**: `POST /rci/` `parse: interface Bridge0 ip address …`, `ip dhcp pool <name> range …`, `system configuration save`. Ответ обычно не доходит (портал идёт к роутеру по старому адресу) — затем в CFK-контейнере роутера (`containerNameOf`) проброс веба `--dport <порт checkUrl> → <старый IP>:80` заменяется на новый адрес, DHCP контейнера обновляется (`dhclient -r/-nw`), результат проверяется по новому адресу (до ~1 мин). Контейнер сам адрес роутера не отслеживает (`monitorRoutes.sh` правит только маршруты).
- **Свич**: основной WAN-порт потребителя — без тега в `vlanLocal` источника, второй WAN-порт — 4094 (`applyWanChange(…, { stateType: { type: 'router_lan', upstreamId, vlan } })`). VLAN LAN роутеров должны быть на WAN-свиче (отдельный линк между свичами только с этими VLAN). Сбой свича — откат WAN и подсети.
- **Разборка** (`dismantleChainOf`, вся связная схема, от нижних звеньев к верхним): WAN потребителя → 4094, подсеть и пул — назад (`original`), контейнер — назад. Когда: снятие брони любого звена (вручную / Release All — **до** снятия; не разобралась — бронь не снимается), истечение брони (сначала разборка, бронь снимается после, если не продлили), заводской сброс звена (у сбрасываемого подсеть не возвращается — только контейнер), смена WAN потребителя, кнопка Dismantle; `reconcileLanWan` раз в минуту — страховка (бронь звена пропала). Звено схемы нельзя перевести в extender (отказ «dismantle the chain first»).
- **Интерфейс**: в «My Booked Devices» — блок **WAN chains** (`LanWanChains` / `LanWanChainNode`): дерево «источник → потребители», VLAN, подсети (отметка «changed»), кнопка Dismantle; в таблицах WAN потребителя — «LAN ← <hwId>»; окна снятия брони предупреждают, что схема будет разобрана.
- Не проверено на железе (октябрь 2026, сделано на деве): смена подсети через RCI, перенастройка контейнера, VLAN LAN на WAN-свиче.

### 8.17 Образ CFK-контейнера устройства (`ndsr-deploy/device-image`)

Исходники образа контейнера устройства (Xvfb + XFCE + Firefox ESR под noVNC, TFTP, `changeContainersIp.sh`, `monitorRoutes.sh`) — в репозитории (раньше жили только на 78 в `~/NDSR_PROJECT/docker_image`). Сборка: `docker build --network host -t ndsr-device:<тег> ndsr-deploy/device-image`.

- **Без `privileged`**: в compose `cap_add: [NET_ADMIN, NET_RAW]` — проверено на 196 (2026-10-28): DHCP/статический fallback на `kn*`, `ip route`, iptables (DNAT веба), ping, TFTP :69, `ip_forward=1` в netns сохраняется. Прежде `privileged: true` + `SYS_ADMIN` давали из контейнера фактически root на хосте.
- **SSH только по ключу**: пароль root случайный, `PasswordAuthentication no`. Ключей в образе и в репозитории нет: на стенде файл `~/ndsr-secrets/device_authorized_keys` (публичные ключи) монтируется в compose на `/etc/ndsr/ssh/authorized_keys:ro`, при старте `ssh-keys.sh` копирует его в `/root/.ssh` с владельцем root (sshd не принимает чужого владельца); нет файла — SSH закрыт (портал ходит через `docker exec`). Инструкция — `ndsr-deploy/device-image/README.md`. Раньше `root:root` по паролю на опубликованном порту.
- База зафиксирована по дайджесту (`debian:bookworm-slim@sha256:…`), пакеты — последние из bookworm; noVNC 1.1.0 проверяется по SHA256 (1.4.0 из браузера не работал); без pulseaudio; пароль VNC — `VNC_PASSWORD` (подставляется и в `index.html`).
- **Память**: Firefox — один процесс контента, без Fission, кэш в памяти 32 МБ; сторож `firefox-idle-guard.sh` закрывает Firefox, если к noVNC/VNC `FIREFOX_IDLE_MIN` (30) минут никто не подключён — брошенный Firefox держал 0,75–1,3 ГБ и до ~500 процессов на контейнер (78). Простой контейнер ~90–115 МБ. Лимитов памяти/процессов в compose нет намеренно (контейнер не должен падать); есть ротация docker-логов 10 МБ × 3.
- **Логи**: одинаковое сообщение — не чаще раза в 10 мин, файл ≤ 5 МБ (+ `.1`); было 26 МБ `monitorRoutes.log` и 14 МБ `changeContainersIp.log` в слое контейнера. `monitorRoutes.sh` проверял наличие маршрутов по неполному списку (172.16.80/78, 10.150.19 «отсутствовали» каждые 10 с) — теперь `ip route show` по каждой сети; шлюз — аргумент → `CFK_GATEWAY` → первый адрес подсети eth0 (раньше зашит 10.10.19.1). `atftpd` с `--no-fork` (supervisor видел FATAL, хотя TFTP работал).
- `changeContainersIp.sh` берёт шлюз из DHCP LAN роутера и сам переписывает DNAT веба на него; без DHCP — статический 192.168.1.254 и шлюзы 192.168.1.3 / .1 (зашиты).
- **NAT и шлюз** — скрипт сам ставит MASQUERADE в eth0 и в LAN и TCPMSS (вместо `masquerade.sh` стенда; без MASQUERADE в LAN веб снаружи не открывается), удаляет default через eth0. В compose на Docker 28+ у сети стенда `gw_priority: 1` — иначе `ports` не публикуются. Подробнее — `ndsr-deploy/device-image/README.md`.
- **Порт веба** — переменная `WEB_PORT` (compose, из `<P>_WEB` в VARS.env стенда); без неё порт берётся из имени интерфейса `kn…`/`nc…` с отбрасыванием одного нуля (`nc43100` → 4310), и мост с другим именем (`kmb420`, `kn1011gp`) давал неверный порт или останавливал скрипт. С `WEB_PORT` интерфейс LAN — первый, кроме `lo`/`eth0`. На 196 так и запущено (`~/ndsr.yml`).
- **Адрес роутера, заданный порталом** — `/etc/ndsr/router-ip` в контейнере («192.168.2.1/24»). Пока файл есть, скрипт берёт адрес из него (главнее DHCP и зашитых .1/.3): добавляет себе `.254` в подсети роутера, если DHCP такой не дал, ставит DNAT веба на этот адрес, остальную логику цикла пропускает; файла нет — убирает свой `.254` и проброс, запрашивает DHCP, прежняя логика. Портал (`services/routerIpService.js`): `device.routerLanIp` в devices.json (null — авто), запись/удаление файла через `docker exec`, `reconcileRouterIps` — при старте бэкенда и раз в 5 мин (файл в слое контейнера пропадает при пересоздании), событие `device:routerLanIp`. Задаётся вручную — `device:setRouterLanIp` (бронь владельца): «More» → Network → «Router LAN IP…» и карандаш у строки «Router LAN IP» в «My Booked Devices»; «LAN как WAN» пишет новый адрес и при разборке возвращает прежний; заводской сброс снимает. Старые образы (77/78) файл не читают.
- Стенд 172.16.80.196 (2026-10-28): собраны `ndsr-backend:2026-10`, `ndsr-frontend:2026-10` (из `768cbed`, код в `~/NDSR/ndsr-app`), `ndsr-device:2026-10` (как на 78) и `ndsr-device:2026-10-hardened`; `~/ndsr.yml` — без privileged, `IMAGE` в `~/VARS.env` — hardened (копии `*.bak-20261028-*`).

### 8.13 Администратор: массовое питание и сброс

Администраторы — IP из `ADMIN_IPS` (через запятую, env бэкенда; меняется без пересборки, нужен рестарт). Другого понятия «админ» в портале нет.

- Фронт: `useAdminStore` спрашивает `admin:whoami` при каждом подключении сокета; админу в Sidebar → Device Management виден пункт **Bulk Power / Reset** → `AdminBulkPowerDialog` (смонтирован в `App.vue`): все устройства (наши и конкуренты) с галочками, фильтр, All/None, «Refresh power» (опрос PowerHub по выбранным), Power On / Power Off / Reboot / Factory Reset с подтверждением (в нём — чужие брони и пропущенные конкуренты).
- Бэкенд (`socket/handlers/adminBulk.js`): `admin:bulkPower { deviceIds, action: status|on|off|reboot|reset }` — `requireAdmin`, **брони не проверяются**; одна операция одновременно; устройства по одному в фоне (`powerSetup` / `rebootDevice` / `factoryResetDevice` / `getPortPowerStatus`), ход — инициатору `admin:bulkProgress` и `admin:bulkDone`, статусы питания — всем `device:powerStatus`. Factory reset конкурентов запрещён (как и в 8.11), питание и перезагрузка — можно.
- Лог: `[ADMIN] <ip>: bulk <action> for N devices`, итог `[ADMIN] bulk <action> finished: X ok, Y failed`.

## 9. Конфигурация и данные

### 9.1 Переменные бэкенда (`ndsr-app/api/.env`)

Шаблон — `ndsr-app/api/.env.example` (актуален).

| Группа | Переменные |
|---|---|
| Сервер | `WS_PORT`, `UPLOAD_DIR`, `UPLOADS_META_PATH` (кто загрузил файлы; по умолчанию рядом с `devices.json`), `STATUS_CHECK_INTERVAL` (с, ≥5), `STATUS_CHECK_TIMEOUT` (с) |
| Пути к данным | `DEVICES_CONFIG_PATH`, `WAN_TYPES_CONFIG_PATH`, `USER_CONFIG_PATH`, `BADGES_CONFIG_PATH`, `CURRENT_MODES_PATH`, `BOOKINGS_PATH`, `MWS_LINKS_PATH`, `VMS_CONFIG_PATH`, `VM_ATTACHMENTS_PATH` (относительные пути считаются от cwd) |
| Тестовые VM | `VM_TRUNK_IFACE` (trunk-NIC хоста; по умолчанию определяется сам — родитель существующих VLAN-интерфейсов: в netplan стенда `int` — только id netplan, в системе имя ядра вроде `ens160`), `VM_RDP_IN_IFACE` (`internet`), `VM_RDP_PUBLIC_HOST` (адрес docker-хоста для RDP-клиента), `GUACD_HOST`/`GUACD_PORT`/`GUAC_WS_PORT`/`GUAC_TOKEN_TTL_MS` (RDP в браузере; пустой `GUACD_HOST` — выключено), `VM_RDP_SOURCE_OVERRIDE` (только dev: адрес-источник для RDP-правила вместо IP браузера — dev-бэкенд видит браузер по локальной сети, а mstsc приходит на хост с VPN-адреса) |
| Логи | `LOG_DIR` (пусто — только stdout), `LOG_MAX_SIZE_MB`, `LOG_MAX_FILES` |
| Клиенты | `TRUST_PROXY_HEADERS`, `VPN_IP_PREFIXES`, `ADMIN_IPS` (8.13) |
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

- **идентификация**: `id` (он же порт проброса для MWS), `hwId` (= имя CFK-контейнера, если не задан `container`), `container` (имя CFK-контейнера, когда оно не совпадает с hwId — на 77 у NC-1013 это `KN-1013`), `type`, `shortName`, `country`, `macAddress`, `serialNumber`, `servicetag`;
- **доступ**: `ip`, `checkUrl`, `URL`, `vncUrl`, `checkDeviceMode`;
- **консоль**: `consoleID`, `consolePort`;
- **питание**: `jeromeID`, `jeromeClass` (`old`/`new`), `rebootPort`, `resetPort`;
- **коммутация**: `vlanLocal`, `switchID`, `switchPortLan`, `switchIDWan`, `switchPortWan`, `switchIDWanSecondary` (свич второго WAN-порта, пусто = тот же), `switchPortWanSecondary`, `port` (для MWS-trunk роутера);
- **прочее**: `currentWanType`, `tftpInterfaceName`, `dslPort`, `hwType`, `rivals` (`true` — устройство конкурента, см. 8.11);
- **пароль**: `devicePassword` — намеренно виден всем пользователям портала (см. 8.3).

Чего не хватает сейчас:

- `macAddress` нужен для MWS и поиска IP экстендера (MAC LAN/Bridge0; при подключении экстендера с пустым — читается с устройства и сохраняется);
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
| Статусы перестали обновляться до F5 | раньше — `socket.off` без handler в `ProgressModal`/`PrimeDeviceModal` (исправлено, 12.2); сейчас — искать другой `socket.off(event)` без handler | перезагрузка страницы |
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
| Смена режима висит | ожидание MWS-кандидата может длиться десятки минут; экстендер не видит роутер (VLAN); у экстендера неверный `macAddress` (в логе `Ожидание появления extender'а <MAC>`) | лог changeModeType; `show mws candidate` на роутере; события `device:modeChangeProgress` |
| Мобильный: в окне смены режима не открывается список роутеров, окно не закрывается до перезагрузки | у Dropdown был `appendTo=null` (для PrimeVue — Teleport в никуда), рендер окна ломался: `Cannot read properties of null (reading 'emitsOptions')` | исправлено 29.10.2026 (`ChangeModeModal.vue`: панель всегда в `body`); у новых Dropdown в окнах — `appendTo="body"` или `"self"`, не null |
| Режим показан неверно | устаревший localStorage `deviceCurrentMode`; `current_modes.json` из старого деплоя | очистить localStorage; `current_modes.json`; «обновить режим» в UI |
| Подключение экстендера: «Контейнер … не запущен» | имя CFK-контейнера роутера ≠ hwId (`docker ps`) | задать `"container": "<имя>"` у роутера в devices.json; при ошибке подключения портал сам откатывает свич (порт экстендера → его VLAN) и пробросы, устройство остаётся в extender — вернуть в router или сбросить |
| Операции через хост (Router LAN IP, TFTP, VM, пробросы) — «Not connected» / «All configured authentication methods failed» | бэкенд не может войти по SSH на docker-хост: публичный ключ `ndsr-secrets/id_ed25519.pub` не в `authorized_keys` пользователя `SSH_USERNAME` | `docker logs ndsr-app-back \| grep SSH`; после добавления ключа рестарт не нужен — `services/docker.js` переподключается при следующей операции (раньше неудачное подключение запоминалось до рестарта) |
| Веб экстендера через роутер не открывается | нет DNAT на хосте/в контейнере (после `nft -f` / пересоздания CFK роутера сверка вернёт его за 2–4 мин; `extenderIp: null` в `mws_links.json` — адрес экстендера ещё не найден в DHCP роутера); IP экстендера не найден (нет `macAddress`); экстендер сменил IP по DHCP | `mws_links.json` (`extenderIp`); `nft list table ip nat`; `docker exec <router hwId> iptables -t nat -S`; лог бэкенда `MWS … restoring` / `MWS forward reconcile` (8.5) |
| После отключения/сброса экстендер всё ещё в сети роутера или веб открывается через роутер | связка разобрана не до конца (см. 8.5, «Что создаёт подключение…») | пройти по таблице в 8.5; повторить отключение или factory reset экстендера — снятие идемпотентно |
| Сброс подключённого экстендера: «Router is booked by another user» | роутер в чужой брони, связку трогать нельзя | дождаться освобождения роутера или попросить владельца отключить экстендер |
| Сброс подключённого экстендера падает сразу, устройство не сбрасывается | не удалось откатить коммутатор или NAT (telnet к LAN-коммутатору, SSH к docker-хосту) | лог `reconfigureSwitchWithLocalVlan` / `removeIptablesRulesOnly`; `SWITCH_*`, `SSH_*` |
| TFTP IP не показывается | нет SSH до docker-хоста (`SSH_*`, ключ), нет `tftpInterfaceName`, контейнер `hwId` не найден | лог `DockerManager`; `ssh <SSH_HOST> docker exec <hwId> ip addr` |
| Загрузка файлов не работает | неверный `VITE_API_URL`, нет прав на `UPLOAD_DIR`, лимит 100 МБ / расширение | Network → `/api/upload`; лог `📁` |
| Окно консоли одного устройства открывает другое | у двух устройств одинаковые `consoleID` + `consolePort` в devices.json — бэкенд пишет при загрузке/reloadConfigs `⚠️ devices.json: X and Y share console N:P` (на 78 так были 1112/4910, 2911/4110, 1913/1714, 30132/4210) | исправить порт по проводке консоль-сервера |
| Консоль не открывается | блокировщик попапов; окно портала: нет хоста в `CONSOLE_HOSTS` / `consoleID`/`consolePort`, консоль-сервер недоступен; webtelnet: cooldown 60 с, контейнер недоступен | статус в окне консоли, лог бэкенда `🖥️ Console`; sessionStorage `consoleCooldown_<id>`; `docker logs ndsr-webtelnet-console` |
| Утром сброшены устройства / выключен WAN | включён cron (04:00: отключение экстендеров, затем WAN off + reset незабронированных) | переключатель cron в шапке |
| Утром часть устройств не сброшена | забронированы; роутер связки забронирован; отключение экстендера не удалось (тогда пропущены и экстендер, и роутер) | лог `Skipping …`, `Failed to disconnect extender …` (8.10) |
| Ошибка «Not available for rival devices.» | у устройства `rivals: true` — операция запрещена намеренно (8.11) | `devices.json`; если устройство наше — убрать поле и `device:reloadConfigs` |
| VM подключена, адреса в портале нет | смотреть причину в диалоге VM. «Not in the router DHCP table»: сторож в Windows не отработал (`Get-ScheduledTask NDSR-LanWatchdog`, журнал `C:\ProgramData\NDSR\lan-watchdog.log`) или VLAN LAN устройства не доходит до docker-хоста; «lanMac is not set» — дописать MAC в `vms.json` | `ip -d -o link show type vlan \| grep "id <vlan>"` (интерфейс VM — `ndsr-vm<vlan>` или заранее заведённый); `bridge link show master <мост>`; лог `🖥️ VM … LAN address` |
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

- ~~`socket.off(event)` без handler в `ProgressModal` и `PrimeDeviceModal` снимал слушатели сторов~~ — исправлено (октябрь 2026): оба окна регистрируют свои обработчики через `listen()` и снимают только их; отладочный `socket.onAny` убран, `device:modeChangeResult` больше не копится. Симптомы были: статусы и режимы не обновлялись до F5, окно прогресса MWS «глохло» после закрытия окна MWS.
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
- webtelnet (запасной путь консоли, 8.15) собирается из GitHub (`flask-remote-terminal`) на Python 3.6 (EOL): без интернета на docker-хосте образ не соберётся.
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
