const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    PHONENUMBER_MCC
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const readline = require('readline');
const fs = require('fs');
const config = require('./config');
const chalk = require('chalk');
const handler = require('./lib/handler');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startShahBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version, isLatest } = await fetchLatestBaileysVersion();

    console.log(chalk.blue(`Using WhatsApp v${version.join('.')}, isLatest: ${isLatest}`));

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: !config.pairingCode,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    if (config.pairingCode && !sock.authState.creds.registered) {
        let phoneNumber = await question(chalk.yellow('\nEnter your phone number with country code (e.g., 923XXXXXXXXX): '));
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

        if (!PHONENUMBER_MCC[phoneNumber.substring(0, 3)]) {
            console.log(chalk.red("Invalid country code. Please start with country code."));
            process.exit(0);
        }

        setTimeout(async () => {
            let code = await sock.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(chalk.green(`\nYOUR PAIRING CODE: `), chalk.white.bgRed.bold(` ${code} `));
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                console.log(chalk.red('Device Logged Out, Please Delete Session and Scan Again.'));
                process.exit();
            } else {
                startShahBot();
            }
        } else if (connection === 'open') {
            console.log(chalk.green('Connected Successfully! 👑 SHAH MD 👑 is online.'));
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const m = chatUpdate.messages[0];
            if (!m.message) return;
            await handler(sock, m, config);
        } catch (err) {
            console.log(err);
        }
    });
}

startShahBot();
