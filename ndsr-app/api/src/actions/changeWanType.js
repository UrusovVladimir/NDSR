import {TelnetConnection} from "./telnetClassEthernet.js"

import {getDeviceById, getVlanId, wanTypes} from "../devices.js";


 async function changeWanType(deviceId,checkedWanTypeIds) {
    console.log('checkedWanTypeIds',checkedWanTypeIds)
    let selectedWanTypes = wanTypes.find(wan => checkedWanTypeIds.includes(String(wan.vlanId)))
    // let selectedWanTypes = wanTypes.filter(wan => checkedWanTypeIds === wan.vlanId)
    console.log('Выбранный метод:',selectedWanTypes)
    let PVID = wanTypes.find(command => "onVlanPVID" === command.setting)
    let VLAN = wanTypes.find(command => "onVlanFixPort" === command.setting)
    let OFF_VLAN = wanTypes.find(command => "offVlanFixPort" === command.setting)
    let device = getDeviceById(deviceId);
    let wanVlan = getVlanId()

    const connection = new TelnetConnection(process.env.SWITCH,process.env.SWITCH_LOGIN,process.env.SWITCH_PASSWORD);

    let res;
        await connection.connect();
        

        if (selectedWanTypes) {
            await connection.executeCommand( 'configure', null, /MGS3520_NDW3\(config\)[# ]/i);
            
            for (let cmd of OFF_VLAN.commands){
                for (let wan of wanVlan){
                    console.log("vlan",+ wan)
                    await connection.executeCommand("vlan", wan, /MGS3520_NDW3\(config-vlan\)[# ]/i);
                    await connection.executeCommand(cmd, device.switchPortWan, /MGS3520_NDW3\(config-vlan\)#/i);
                    await connection.executeCommand("exit",null,/MGS3520_NDW3\(config\)[# ]/i);
                }}
                
                    let vlan = selectedWanTypes.vlanId;
                    for (let cmd of PVID.commands) {
                        await connection.executeCommand( cmd, cmd === 'interface port-channel' ? device.switchPortWan : (cmd === 'pvid' ? vlan : null), /MGS3520_NDW3\(config-interface\)[# ]/i);
                        }
                    await connection.executeCommand("exit",null,/MGS3520_NDW3\(config\)[# ]/i);
                    await connection.executeCommand( "vlan", vlan, /MGS3520_NDW3\(config-vlan\)[# ]/i);
                
                for (let cmd of VLAN.commands) {
                        await connection.executeCommand( cmd, device.switchPortWan, /MGS3520_NDW3\(config-vlan\)[# ]/i);
                    }
                }
        else {
            console.error(`No WAN types matching the given VLAN IDs found.Applying fake vlan`);
            let OFF_PVID = wanTypes.find(command => "offVlanPVID" === command.setting)
            await connection.executeCommand( 'configure', null, /MGS3520_NDW3\(config\)[# ]/i);
            let switchPort = device.switchPortWan
            
            for (let cmd of OFF_PVID.commands){
                let fakeVlan = "4094"
                await connection.executeCommand( cmd, cmd === 'interface port-channel' ? device.switchPortWan : (cmd === 'pvid' ? fakeVlan : null), /MGS3520_NDW3\(config-interface\)[# ]/i);
            }
            await connection.executeCommand("exit",null,/MGS3520_NDW3\(config\)[# ]/i);
            for (let cmd of OFF_VLAN.commands){
                for (let wan of wanVlan){
                    await connection.executeCommand("vlan", wan, /MGS3520_NDW3\(config-vlan\)[# ]/i);
                    await connection.executeCommand(cmd, device.switchPortWan, /MGS3520_NDW3\(config-vlan\)#/i);
                    await connection.executeCommand("exit",null,/MGS3520_NDW3\(config\)[# ]/i);
                }
            }

        }
    
    

        await connection.end(); // Не забудьте закрыть соединение
 }


 export{
    changeWanType
 }
