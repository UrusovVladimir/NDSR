export  const getManagmentID = (array) => {
    const ipsString = array
    const ipArray = ipsString.split(',').filter(ip => ip.trim());
    
    const result = {};
    ipArray.forEach((ip, index) => {
      result[(index + 1).toString()] = ip.trim();
    });
    return result;
  };