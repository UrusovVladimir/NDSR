#!/bin/bash
# Скрипт настройки Firefox ESR для работы в контейнере

echo "Настройка Firefox ESR..."

# Создаем необходимые директории
mkdir -p /root/.cache /root/.config /tmp/.cache /tmp/.config
chmod 755 /root/.cache /root/.config /tmp/.cache /tmp/.config

# Настраиваем переменные окружения для Firefox
export DBUS_SESSION_BUS_ADDRESS="unix:path=/var/run/dbus/system_bus_socket"
export MOZ_DISABLE_RDD_SANDBOX=1
export MOZ_DISABLE_CONTENT_SANDBOX=1
export MOZ_DISABLE_GMP_SANDBOX=1
export MOZ_X11_EGL=1

# Запускаем DBUS если не запущен
if [ ! -S /var/run/dbus/system_bus_socket ]; then
    echo "Запуск DBUS..."
    dbus-daemon --system --fork
    sleep 2
fi

# Создаем настройки Firefox для отключения предупреждений
mkdir -p /root/.mozilla/firefox/default
cat > /root/.mozilla/firefox/default/user.js << 'EOF'
// Отключаем различные предупреждения и проверки
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.page", 0);
user_pref("browser.startup.homepage", "about:blank");
user_pref("startup.homepage_welcome_url", "about:blank");
user_pref("browser.startup.firstrunSkipsHomepage", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("datareporting.policy.firstRunURL", "");
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("browser.rights.3.shown", true);
user_pref("browser.startup.upgradeDialog.enabled", false);
user_pref("extensions.shownSelectionUI", true);
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.tabs.warnOnOpen", false);
user_pref("dom.disable_beforeunload", true);
user_pref("browser.sessionstore.resume_from_crash", false);
// Память: один процесс контента, без Fission, ограниченный кэш и история
user_pref("fission.autostart", false);
user_pref("dom.ipc.processCount", 1);
user_pref("dom.ipc.processCount.webIsolated", 1);
user_pref("browser.tabs.remote.autostart", true);
user_pref("browser.cache.disk.enable", false);
user_pref("browser.cache.memory.capacity", 32768);
user_pref("browser.sessionhistory.max_total_viewers", 0);
user_pref("browser.sessionstore.interval", 600000);
user_pref("media.autoplay.default", 5);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("toolkit.telemetry.enabled", false);
user_pref("app.update.enabled", false);
user_pref("extensions.pocket.enabled", false);
EOF

echo "Firefox ESR настроен"

# Страница noVNC: пароль VNC из переменной (как у x11vnc в supervisor)
if [ -f /usr/share/novnc/index.html.tpl ]; then
    sed "s/password: 'password'/password: '${VNC_PASSWORD:-password}'/" \
        /usr/share/novnc/index.html.tpl > /usr/share/novnc/index.html
fi
