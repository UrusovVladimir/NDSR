import fs from 'fs';

function generatePassword(length = 8) {
    let password = '';
    for (let i = 0; i < length; i++) {
        const string = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ><}{_?)(0123456789!@#$%^&*+/';
        password += string.charAt(Math.floor(Math.random() * string.length));
    }
    return password;
}

function savePasswordToFile(password = null) {
    if (!process.env.PASSWORD_FILE_PATH)
        throw new Error('PASSWORD_FILE_PATH is not defined')

    if (!password)
        password = generatePassword()

    fs.writeFile(path, password, (err) => {
        if (err) return console.log(err);
        console.log('The password has been saved/changed.');
    });
}


