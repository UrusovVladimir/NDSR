import {TelnetConnection} from "./telnetClassEthernet.js"
import {getParamRouter, devices,wanTypes} from "../devices.js";



// vlanLocal - это vlan к которому нужно подключить экстендер deviceId которого передается в сокет. switchPortLan - это порт свича к которому подключен экстендер

 async function connectToMws(extenderId,routerId,disconnectExtender,universalPromptRegex) {
    const extender = devices.find(extender => String(extender.id) === (String(extenderId)))
    const router = getParamRouter(routerId)
    
 

    let PVID = wanTypes.find(command => "onVlanPVID" === command.setting)
    let VLAN_ACCESS = wanTypes.find(command => "onVlanFixPort" === command.setting)
    let VLAN_TRUNKING = wanTypes.find(command => "VlanTrunking" === command.setting)
    let lanVlan = router.vlan
    let PORTS=[]
    PORTS.push(extender.switchPortLan,router.port)

    const switchAddress = devices.switchID === "1" 
    ? process.env.SWITCH_ID_1 
    : process.env.SWITCH_ID_2;
    const connection = new TelnetConnection(switchAddress,process.env.SWITCH_LOGIN,process.env.SWITCH_PASSWORD);

    let res;
        await connection.connect();


        if (disconnectExtender === "disconnect") {
            await connection.executeCommand( 'configure', null, universalPromptRegex);
            let fakeVlan = "4094"
            console.log("vlan",+ fakeVlan)
            let OFF_PVID = wanTypes.find(command => "offVlanPVID" === command.setting)
            for (let cmd of OFF_PVID.commands){
            await connection.executeCommand( cmd, cmd === 'interface port-channel' ? extender.switchPortLan : (cmd === 'pvid' ? fakeVlan : null), universalPromptRegex);
            }
            await connection.executeCommand("exit",null,universalPromptRegex);}

        else{
            await connection.executeCommand("configure", null, universalPromptRegex);
            console.log(`Disconnecting extender. Applying fake vlan`);

            for (let cmd of PVID.commands) {
                await connection.executeCommand( cmd, cmd === 'interface port-channel' ? extender.switchPortLan : (cmd === 'pvid' ? lanVlan : null), universalPromptRegex);
            }
            await connection.executeCommand("exit",null,universalPromptRegex);
            await connection.executeCommand("vlan", lanVlan, universalPromptRegex);
            for (let cmd of VLAN_ACCESS.commands){
                await connection.executeCommand( cmd, extender.switchPortLan, universalPromptRegex);
            }
            await connection.executeCommand("exit",null,universalPromptRegex);
            for(let port of PORTS){
                for (let cmd of VLAN_TRUNKING.commands){
                    await connection.executeCommand( cmd, cmd === 'interface port-channel' ? port : null, universalPromptRegex);
            }
            await connection.executeCommand("exit",null,universalPromptRegex);

        }
    }
        await connection.end(); 
 }


 export{
    connectToMws
 }