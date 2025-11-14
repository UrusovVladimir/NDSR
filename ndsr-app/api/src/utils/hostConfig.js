export const HOST_CONFIG = {
    mainHost: {
        host: process.env.SSH_HOST || '10.10.19.1',
        port: parseInt(process.env.SSH_PORT) || 9678,
        username: process.env.SSH_USERNAME || 'v.urusov',
        // privateKeyPath: process.env.SSH_PRIVATE_KEY_PATH || '/root/.ssh/id_rsa'
        privateKeyPath: process.env.SSH_PRIVATE_KEY_PATH
    }
};