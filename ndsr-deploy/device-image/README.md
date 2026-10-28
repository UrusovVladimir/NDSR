# Образ CFK-контейнера устройства

Контейнер на каждое устройство стенда: Xvfb + XFCE + Firefox ESR под noVNC (веб роутера из браузера портала), TFTP для прошивок, `changeContainersIp.sh` (DHCP в LAN роутера, проброс веба на роутер) и `monitorRoutes.sh` (маршруты к сетям портала через eth0). Подробнее — PROJECT.md, раздел 8.17.

## Сборка

На docker-хосте стенда, из каталога с этими файлами:

```sh
docker build --network host -t ndsr-device:<тег> .
```

В `~/VARS.env` стенда — `IMAGE=ndsr-device:<тег>`.

## Что нужно в compose (`~/ndsr.yml`)

У каждого сервиса устройства:

```yaml
    # без privileged: скриптам хватает NET_ADMIN + NET_RAW
    cap_add:
      - NET_ADMIN
      - NET_RAW
    volumes:
      - /home/<пользователь>/ndsr-secrets/device_authorized_keys:/etc/ndsr/ssh/authorized_keys:ro
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

`privileged: true` и `SYS_ADMIN` не нужны (с ними контейнер — фактически root на хосте).

## Ключ SSH в контейнеры

В образе ключей нет, пароль root случайный, вход по паролю выключен. Доступ по SSH (root) — только по ключам из файла **на стенде**:

```sh
mkdir -p ~/ndsr-secrets && chmod 700 ~/ndsr-secrets
cat ~/.ssh/<твой-ключ>.pub >> ~/ndsr-secrets/device_authorized_keys   # публичные ключи, по одному в строке
chmod 644 ~/ndsr-secrets/device_authorized_keys
```

Файл монтируется в контейнер на `/etc/ndsr/ssh/authorized_keys` (см. compose выше); при старте контейнера `ssh-keys.sh` копирует его в `/root/.ssh/authorized_keys` с владельцем root (sshd не принимает файл ключей чужого владельца). Ключи поменялись — перезапустить контейнеры (`docker compose -f ~/ndsr.yml --env-file ~/VARS.env restart`). Файла нет — SSH закрыт; портал в контейнеры ходит через `docker exec`, ему SSH не нужен.

Ключи в репозиторий не кладутся (`ndsr-deploy/device-image/ssh/` в `.gitignore`).

## Переменные окружения контейнера

| Переменная | По умолчанию | Что |
|---|---|---|
| `VNC_PASSWORD` | `password` | пароль x11vnc (подставляется и в страницу noVNC) |
| `FIREFOX_IDLE_MIN` | `30` | через сколько минут без клиентов noVNC/VNC закрыть Firefox |
| `CFK_GATEWAY` | первый адрес подсети eth0 | шлюз к сетям портала для `monitorRoutes.sh` |
| `LOG_REPEAT_SEC` | `600` | одинаковое сообщение в логах скриптов — не чаще |

## Адрес роутера, заданный порталом

Файл `/etc/ndsr/router-ip` («192.168.2.1/24») пишет портал (`routerIpService`), когда адрес роутера знает он сам: «LAN как WAN» сменил подсеть или адрес вписан вручную (у роутера выключен DHCP). Пока файл есть, `changeContainersIp.sh` берёт адрес из него вместо DHCP и зашитых 192.168.1.1 / .3.
