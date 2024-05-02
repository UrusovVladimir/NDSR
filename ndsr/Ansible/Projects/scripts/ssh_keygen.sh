SSH_KEYGEN=$(which ssh-keygen)
SSH=$(which ssh)
SSH_COPY_ID=$(which ssh-copy-id)
KEYSIZE=4096
PASSPHRASE=""
FILENAME=~/.ssh/id_ansible
KEYTYPE=rsa
USER=ansible

if [ -z "${SSH_KEYGEN}" ]; then
    echo Could not find the 'ssh-keygen' executable
    exit 1
fi
if [ -z "${SSH}" ]; then
    echo Could not find the 'ssh' executable
    exit 1
fi

if [ -f "${FILENAME}" ]; then
   echo -e -n "Using existing ${FILENAME}: \n"
   cat ${FILENAME}.pub
    exit 1
else
    echo -e -n "Creating a new key using ${SSH-KEYGEN} \n"
    ${SSH_KEYGEN} -t ${KEYTYPE} -b ${KEYSIZE} -f "${FILENAME}" -N "${PASSPHRASE}" -C ${USER}
    RET=$?
    if [ ${RET} -ne 0 ]; then
        echo ssh-keygen failed: ${RET}
        exit 1
    else
        echo -e -n "Creation of the ssh-key is complete! Public key: \n"
        cat ${FILENAME}.pub
    fi
fi