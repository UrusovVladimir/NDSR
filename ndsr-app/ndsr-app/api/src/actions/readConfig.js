import {readFileSync} from "fs";

export function readConfig(path) {
    let data = readFileSync(path, {encoding: 'utf8', flag: 'r'});
    return JSON.parse(data)
}