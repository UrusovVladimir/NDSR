import {TelnetConnection} from "./telnetClassEthernet.js"
import {getParamRouter, devices,wanTypes} from "../devices.js";



// vlanLocal - это vlan к которому нужно подключить экстендер deviceId которого передается в сокет. switchPortLan - это порт свича к которому подключен экстендер

 async function connectToMws(extenderId,routerId,disconnectExtender) {
    const extender = devices.find(extender => String(extender.id) === (String(extenderId)))
    console.log(extender)
    const router = getParamRouter(routerId)
    
 

    let PVID = wanTypes.find(command => "onVlanPVID" === command.setting)
    let VLAN_ACCESS = wanTypes.find(command => "onVlanFixPort" === command.setting)
    let VLAN_TRUNKING = wanTypes.find(command => "VlanTrunking" === command.setting)
    let lanVlan = router.vlan
    let PORTS=[]
    PORTS.push(extender.switchPortLan,router.port)

    const connection = new TelnetConnection(process.env.SWITCH,process.env.SWITCH_LOGIN,process.env.SWITCH_PASSWORD);

    let res;
        await connection.connect();


        if (disconnectExtender === "disconnect") {
            await connection.executeCommand( 'configure', null, /MGS3520_NDW3\(config\)[# ]/i);
            let fakeVlan = "4094"
            console.log("vlan",+ fakeVlan)
            let OFF_PVID = wanTypes.find(command => "offVlanPVID" === command.setting)
            for (let cmd of OFF_PVID.commands){
            await connection.executeCommand( cmd, cmd === 'interface port-channel' ? extender.switchPortLan : (cmd === 'pvid' ? fakeVlan : null), /MGS3520_NDW3\(config-interface\)[# ]/i);
            }
            await connection.executeCommand("exit",null,/MGS3520_NDW3\(config\)[# ]/i);}

        else{
            await connection.executeCommand("configure", null, /MGS3520_NDW3\(config\)[# ]/i);
            console.log(`Disconnecting extender. Applying fake vlan`);

            for (let cmd of PVID.commands) {
                await connection.executeCommand( cmd, cmd === 'interface port-channel' ? extender.switchPortLan : (cmd === 'pvid' ? lanVlan : null), /MGS3520_NDW3\(config-interface\)[# ]/i);
            }
            await connection.executeCommand("exit",null,/MGS3520_NDW3\(config\)[# ]/i);
            await connection.executeCommand("vlan", lanVlan, /MGS3520_NDW3\(config-vlan\)[# ]/i);
            for (let cmd of VLAN_ACCESS.commands){
                await connection.executeCommand( cmd, extender.switchPortLan, /MGS3520_NDW3\(config-vlan\)[# ]/i);
            }
            await connection.executeCommand("exit",null,/MGS3520_NDW3\(config\)[# ]/i);
            for(let port of PORTS){
                for (let cmd of VLAN_TRUNKING.commands){
                    await connection.executeCommand( cmd, cmd === 'interface port-channel' ? port : null, /MGS3520_NDW3\(config-interface\)[# ]/i);
            }
            await connection.executeCommand("exit",null,/MGS3520_NDW3\(config\)[# ]/i);

        }
    }
        await connection.end(); 
 }


 export{
    connectToMws
 }