import {TelnetConnection} from "./telnetClassEthernet.js"

import {getDeviceById, getVlanId, wanTypes} from "../devices.js";


 async function changeWanType(deviceId,checkedWanTypeIds,universalPromptRegex) {
    // let selectedWanTypes = wanTypes.find(wan => checkedWanTypeIds.includes(String(wan.vlanId)))
    let selectedWanTypes = wanTypes.filter(wan => checkedWanTypeIds === String(wan.vlanId))
    let PVID = wanTypes.find(command => "onVlanPVID" === command.setting)
    let VLAN = wanTypes.find(command => "onVlanFixPort" === command.setting)
    let OFF_VLAN = wanTypes.find(command => "offVlanFixPort" === command.setting)
    let device = getDeviceById(deviceId);
    let wanVlan = getVlanId()
    const switchAddress = device.switchID === "1" 
      ? process.env.SWITCH_ID_1 
      : process.env.SWITCH_ID_2;
    const connection = new TelnetConnection(switchAddress,process.env.SWITCH_LOGIN,process.env.SWITCH_PASSWORD);



    let res;
        await connection.connect();
        

        if (selectedWanTypes.vlanId !== "4094") {
            console.log("Выбрано",selectedWanTypes)
            await connection.executeCommand( 'configure', null,universalPromptRegex);
            
            for (let cmd of OFF_VLAN.commands){
                for (let wan of wanVlan){
                    await connection.executeCommand("vlan", wan, universalPromptRegex);
                    await connection.executeCommand(cmd, device.switchPortWan, universalPromptRegex);
                    await connection.executeCommand("exit",null,universalPromptRegex);
                }}
                    let vlan = selectedWanTypes[0].vlanId;
                    console.log("vlan выбран",+ vlan)
                    for (let cmd of PVID.commands) {
                        await connection.executeCommand( cmd, cmd === 'interface port-channel' ? device.switchPortWan : (cmd === 'pvid' ? vlan : null),universalPromptRegex);
                        }
                    await connection.executeCommand("exit",null,universalPromptRegex);
                    await connection.executeCommand( "vlan", vlan, universalPromptRegex);
                
                for (let cmd of VLAN.commands) {
                        await connection.executeCommand( cmd, device.switchPortWan, universalPromptRegex);
                    }
                }
        else {
            console.error(`No WAN types matching the given VLAN IDs found.Applying fake vlan`);
            let OFF_PVID = wanTypes.find(command => "offVlanPVID" === command.setting)
            await connection.executeCommand( 'configure', null, universalPromptRegex);
            let switchPort = device.switchPortWan
            
            for (let cmd of OFF_PVID.commands){
                let fakeVlan = "4094"
                await connection.executeCommand( cmd, cmd === 'interface port-channel' ? device.switchPortWan : (cmd === 'pvid' ? fakeVlan : null), universalPromptRegex);
            }
            await connection.executeCommand("exit",null,universalPromptRegex);
            for (let cmd of OFF_VLAN.commands){
                for (let wan of wanVlan){
                    await connection.executeCommand("vlan", wan, universalPromptRegex);
                    await connection.executeCommand(cmd, device.switchPortWan,universalPromptRegex);
                    await connection.executeCommand("exit",null,universalPromptRegex);
                }
            }

        }
    
    

        await connection.end(); // Не забудьте закрыть соединение
 }


 export{
    changeWanType
 }
