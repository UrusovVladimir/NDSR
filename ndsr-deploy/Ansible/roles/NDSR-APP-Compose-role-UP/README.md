# NDSR-APP-Compose-role-UP

Собирает и запускает приложение (frontend, backend, webtelnet) на docker-хосте `TRASP`.
Запускается после стека CFK: сеть `ndsr_default` создаёт `ndsrCompose.yml`.

## Запуск

В роли нет адресов конкретного стенда — стенды разворачивают разные команды. Всё, что зависит
от площадки, задаётся в inventory команды:

```sh
cd ndsr-deploy/Ansible
ansible-galaxy collection install -r requirements.yml          # один раз
cp -r inventory/example inventory/<стенд>                       # каталог в .gitignore
# hosts.ini — адрес/порт/пользователь docker-хоста
# group_vars/all/stand.yml — IP контейнеров, MOXA, Jerome, VES, коммутаторы
# group_vars/all/vault.yml (из vault.yml.example) — пароли, ansible-vault encrypt
ansible-playbook -i inventory/<стенд>/hosts.ini ndsrAppCompose.yml --ask-vault-pass
```

Значения по умолчанию — в `defaults/main.yml` (самый низкий приоритет, inventory их перекрывает),
адресов там нет: SSH бэкенда к хосту и адрес для RDP-клиента по умолчанию берутся из `hosts.ini`
(`ansible_host`, `ansible_port`, `ansible_user`). Роль проверяет `stand_required_vars` и отказывает,
если переменная не задана или осталась заглушка `<…>` из образца — до любых изменений на хосте.
Секреты по-старому из `vars/secrets.yml` роли тоже читаются (если файл есть).

## Что где лежит на хосте

| Путь | Что | Деплой |
|---|---|---|
| `/home/<admin>/ndsr-app/` | код (без `node_modules`, `.env`, ключей, локального состояния) | пересоздаётся целиком |
| `/home/<admin>/ndsr-state/` → `/app/state` | `devices.json`, `users.json`, `bookings.json`, `current_modes.json`, `mws_links.json`, `vms.json`, `vm_attachments.json` | **не трогается** |
| `/home/<admin>/ndsr-uploads/` → `/app/uploads` | прошивки/конфиги из FileManager | не трогается |
| `/home/<admin>/ndsr-logs/` → `/app/logs` | файловый лог бэкенда | не трогается |
| `/home/<admin>/ndsr-secrets/id_ed25519` → `/root/.ssh/id_ed25519:ro` | SSH-ключ бэкенда | перезаписывается из `ssh_key_src` |
| `/home/<admin>/ndsr-app-backend.env` | переменные бэкенда (0600), в контейнер через `env_file` | рендерится |
| `/home/<admin>/nginx.conf` → `/etc/nginx/conf.d/default.conf:ro` | nginx фронта | рендерится; при изменении фронт перезапускается |
| `/home/<admin>/Dockerfile_*`, `ndsr-app.yml`, `VARS-APP.env` | сборка и compose (IP контейнеров — из inventory) | рендерятся |

Образы пересобираются **при каждом деплое** (`build: always`). Контейнеры — `restart: unless-stopped`.

## devices.json и users.json

Бэкенд сам меняет эти файлы (пароли, тип WAN, устройства и пользователи, добавленные через UI),
поэтому они живут в `ndsr-state/` и деплоем не перезаписываются. Версия из репозитория
используется только если файла ещё нет.

- Применить `devices.json` из репозитория (потеряются пароли, WAN и устройства из UI):
  `ansible-playbook … -e devices_json_overwrite=true`
- Миграция со старой схемы (файл в `ndsr-app/api/`) происходит автоматически при первом деплое:
  рабочая копия переносится в `ndsr-state/`, если там пусто.

`wan_types.json` и `badge.json` только читаются — они берутся из образа, меняются через репозиторий.

## Тестовые VM

Пул VM с паролями Windows — `vms.json`, в git его нет. Положить вручную в `ndsr-state/` или в
`files/vms.json` этой роли (в `.gitignore`): роль скопирует его, если в state файла ещё нет
(`-e vms_json_overwrite=true` — перезаписать). Сеть управления VM на хосте настраивает
`setupDockerHost.yml`. Подробно — PROJECT.md, 8.12.

RDP в браузере (Guacamole): `browser_rdp_enabled: true` (по умолчанию) — контейнер `ndsr-guacd`
(`guacd_ip`), WebSocket бэкенда на `guac_ws_port`, nginx проксирует `/guacamole/`.
Откат без правки кода — `-e browser_rdp_enabled=false`: guacd не запускается, `GUACD_HOST` пустой,
в UI остаётся только RDP-клиент.

## Сеть и идентификация пользователей

Браузер ходит только на `:80`. nginx фронта отдаёт статику и проксирует `/socket.io/` и `/api/`
на бэкенд (`backend_ip:ws_port`). Порт бэкенда наружу не публикуется.

Бэкенд определяет пользователя по `X-Real-IP` (`TRUST_PROXY_HEADERS=true`), который nginx
выставляет в адрес клиента. Без этого все пользователи выглядели бы как IP nginx (одна бронь на всех),
а с опубликованным портом бэкенда заголовок можно было бы подделать.

`ws_host` / `api_url` пустые — фронт подключается к адресу страницы. Задавать их нужно, только если
фронт и бэкенд на разных адресах (тогда нужно вернуть публикацию порта и `trust_proxy_headers: false`).

## Секреты

`.env` фронта и бэкенда в git не хранятся — роль генерирует их из `templates/.env.example_*.j2`.
Пароли (VES, коммутатор) и путь к SSH-ключу бэкенда — в `vars/secrets.yml`
(в `.gitignore`; образец — `vars/secrets.yml.example`, можно зашифровать через `ansible-vault`).
В образы секреты не попадают: env бэкенда передаётся через `env_file`, ключ монтируется read-only,
контексты сборки — каталоги приложения с `.dockerignore`.

## Логи

- **stdout всех контейнеров** (`docker logs`) — драйвер `json-file` с ротацией:
  до `container_log_max_file` файлов по `container_log_max_size` на контейнер (по умолчанию 5 × 10m).
- **Файловый лог бэкенда** — `log_host_dir` на docker-хосте (по умолчанию `/home/<admin>/ndsr-logs`),
  монтируется в контейнер как `log_container_dir`. Ротация по размеру: `backend.log` → `backend.log.1` → …,
  всего `log_max_files` файлов по `log_max_size_mb` МБ, самый старый перезаписывается.
  `log_host_dir: ""` — выключить файловый лог.

## Если деплой упал

| Где | Причина | Что делать |
|---|---|---|
| `Check stand variables are set` | в inventory стенда не задана переменная или осталась заглушка `<…>` | заполнить `group_vars/all/stand.yml` / `vault.yml`, перезапустить |
| `Build and start ndsr-app`, `failed to solve` | ошибка сборки образа | вывод задачи; локально: `docker compose -p ndsr-app -f ndsr-app.yml --env-file VARS-APP.env build <service>` в `/home/<admin>` |
| `network ndsr_default … not found` | не поднят стек CFK | сначала `ndsrCompose.yml` |
| `npm ci` падает | `package-lock.json` не соответствует `package.json` | `npm install` локально, закоммитить lock |
| `apt-get … 404` в webtelnet | временная проблема зеркала Debian | повторить позже |
