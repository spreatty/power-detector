const http = require('http');
const axios = require('axios');
const config = require('./config.json');

const log = (...args) => console.log(new Date().toLocaleString(), ...args);
const yes = value => !!value;

const powerOff = 0, powerDetecting = 1, powerBackup = 2, powerMain = 3;
const statusMap = {
    [powerOff]: 'powerOff',
    [powerBackup]: 'powerBackup',
    [powerMain]: 'powerMain'
};
const setStatus = process.argv[2];
var status = setStatus == 'main' ? powerMain : setStatus == 'backup' ? powerBackup : powerOff;
log('Status:', statusMap[status]);

var timer = 0;
var signals = {};

const notify = () => {
    axios.post(config.notificationUrl, {status: statusMap[status]})
        .then(res => log('Response code:', res.status))
        .catch(err => {
            if (err.response) {
                log('Response code:', err.response.status);
              } else {
                log('Error:', err.message);
              }
        });
};

const onUpdate = (payload, signal) => {
    signals[signal] = payload.power == 'charger';
    const powerSignals = Object.values(signals).filter(yes).length;
    if (status == powerOff && powerSignals == 1) {
        status = powerDetecting;
        log('Powering on')
        timer = setTimeout(() => {
            status = powerBackup;
            log('Power backup')
            notify();
        }, config.powerBackupTimeoutMs);
        return;
    }
    if (status == powerDetecting && powerSignals >= config.powerMainThreshold) {
        status = powerMain;
        log('Power main')
        clearTimeout(timer);
        notify();
    }
    if (status != powerOff && powerSignals == 0) {
        status = powerOff;
        log('Power off')
        clearTimeout(timer);
        notify();
    }
};

const createReportServer = port => new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
        if (req.method != 'POST') {
            res.writeHead(400);
            res.end();
            return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            let payload;
            try {
                payload = JSON.parse(body);
                res.writeHead(201);
            } catch(e) {
                res.writeHead(400);
            }
            res.end();
            const signal = payload.signal || port;
            log('Reported', signal, payload);
            if (payload.power) {
                onUpdate(payload, signal);
            }
        });
    });
    try {
        srv.listen(port, () => {
            log('Server listening', port);
            resolve(srv);
        });
    } catch(e) {
        log('Server failed to start', e);
        reject(e);
    }
});

Promise.allSettled(config.reportPorts.map(createReportServer))
    .then(settles => {
        if (settles.some(s => s.reason)) {
            log('Some servers could not start');
            settles.filter(s => s.value).forEach(s => s.value.close());
        } else {
            log('Ready');
        }
    });