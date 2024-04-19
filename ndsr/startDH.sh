#!/usr/bin/env bash
NAME_IMAGE=v.urusov/systemd-debian
PASSWORD=$1
CURRENT_NAME_IMAGE=$(docker image ls --format '{{json .}}' | jq 'select(.Repository == "v.urusov/systemd-debian")' | jq .Repository -r)
###в переменную image, присваевается id image который будет использоваться для создания контейнеров. В текущем примере это v.urusov/systemd:v3

if  [[ ! $CURRENT_NAME_IMAGE == $NAME_IMAGE ]]; then
        sshpass -p $PASSWORD scp -r  -o StrictHostKeyChecking=no root@192.168.77.132:/vmfs/volumes/datastore1/docker_images/novnc_systemd.tar.gz /home/$USER/
        gunzip -c /home/$USER/novnc_systemd.tar.gz | docker load
fi

sed -i '/IMAGE/{d}' ./IMAGE.env
IMAGE=$(docker image ls --format '{{json .}}' | jq 'select(.Repository == "v.urusov/systemd-debian")' | jq .ID -r)
echo "IMAGE=$IMAGE" >> /home/$USER/VARS.env

# bash ./ssh_keygen.sh
# RET=$?
# if [ ${RET} -ne 0 ]; then
#     echo -e "ssh-keygen failed or key was created earlier: exit code is ${RET} \n\n\n"
#     exit 1
# else
#     echo -e "Completed! \n\n\n"
# fi