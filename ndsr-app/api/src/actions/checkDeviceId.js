// [file name]: checkDevices.js
import { devices, getParamRouter, getDeviceById } from '../devices.js';

function checkDevices() {
    console.log('🔍 ПРОВЕРКА КОНФИГУРАЦИИ DEVICES');
    console.log('================================');
    
    // Показываем все устройства
    console.log('\n📱 ВСЕ УСТРОЙСТВА:');
    devices.forEach(device => {
        console.log(`ID: ${device.id}, hwId: ${device.hwId}, URL: ${device.URL}, mac: ${device.macAddress}`);
    });
    
    // Показываем роутеры
    console.log('\n🛜 ВСЕ РОУТЕРЫ:');
    const routers = devices.filter(device => device.type === 'router' || device.isRouter);
    routers.forEach(router => {
        console.log(`ID: ${router.id}, hwId: ${router.hwId}, IP: ${router.ip}`);
    });
    
    // Тестируем поиск
    console.log('\n🔍 ТЕСТИРУЕМ ПОИСК:');
    
    const testRouterId = '1011'; // Замените на реальный ID
    const testDeviceId = '2610'; // Замените на реальный ID
    
    console.log(`Поиск роутера ID ${testRouterId}:`);
    const router = getParamRouter(testRouterId);
    if (router) {
        console.log('✅ Найден:', router);
    } else {
        console.log('❌ Не найден');
    }
    
    console.log(`\nПоиск устройства ID ${testDeviceId}:`);
    const device = getDeviceById(testDeviceId);
    if (device) {
        console.log('✅ Найден:', device);
    } else {
        console.log('❌ Не найден');
    }
}

checkDevices();
