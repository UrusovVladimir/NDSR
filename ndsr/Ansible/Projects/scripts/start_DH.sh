#!/usr/bin/env bash
NAME_IMAGE=systemd
PASSWORD=$1
ADMIN=$2
CURRENT_NAME_IMAGE=$(docker image ls --format '{{json .}}' | jq 'select(.Repository == "systemd")' | jq .Repository -r)
###в переменную image, присваивается id image который будет использоваться для создания контейнеров. В текущем примере это systemd

if  [[ ! $CURRENT_NAME_IMAGE == $NAME_IMAGE ]]; then
        sshpass -p $PASSWORD scp -r  -o StrictHostKeyChecking=no $ADMIN@192.168.77.132:/vmfs/volumes/datastore1/docker_images/novnc_systemd.tar.gz /home/$USER/
        gunzip -c /home/$USER/novnc_systemd.tar.gz | docker load
fi

sed -i '/IMAGE/{d}' /home/$USER/VARS.env
IMAGE=$(docker image ls --format '{{json .}}' | jq 'select(.Repository == "systemd")' | jq .ID -r)
echo -e "\nIMAGE=$IMAGE" >> /home/$USER/VARS.env

# bash ./ssh_keygen.sh
# RET=$?
# if [ ${RET} -ne 0 ]; then
#     echo -e "ssh-keygen failed or key was created earlier: exit code is ${RET} \n\n\n"
#     exit 1
# else
#     echo -e "Completed! \n\n\n"
# fi