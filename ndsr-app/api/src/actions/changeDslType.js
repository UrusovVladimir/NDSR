
import {TelnetConnection} from "./telnetClassDsl.js"
import {getDeviceById, getVlanId, wanTypes} from "../devices.js";

const PVID = wanTypes.find(command => "adslIPoe" === command.setting)

const connection = new TelnetConnection(process.env.VES_IP,process.env.VES_LOGIN,process.env.VES_PASSWORD);
let res;
