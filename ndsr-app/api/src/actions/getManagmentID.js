// Список адресов из переменной окружения («a,b,c») → { "1": a, "2": b, ... }.
// Переменной нет (MOXA_IPS на стенде без webtelnet, 196) — пустой объект:
// раньше undefined.split ронял бэкенд при каждом подключении клиента.
export  const getManagmentID = (array) => {
    const ipsString = String(array ?? '')
    const ipArray = ipsString.split(',').filter(ip => ip.trim());

    const result = {};
    ipArray.forEach((ip, index) => {
      result[(index + 1).toString()] = ip.trim();
    });
    return result;
  };
