const express = require('express');
const axios = require('axios');
const config = require('./config.json');

const log = (...args) => console.log(new Date().toLocaleString(), ...args);
const yes = value => !!value;

const powerOff = 0, powerBackup = 1, powerMain = 2, powerDetecting = 3;
const statusMap = ['off', 'backup', 'main'];
var status = statusMap.indexOf(process.argv[2]);
if (status == -1) {
    status = powerOff;
}
log('Power:', statusMap[status]);

var timer = 0;
var signals = {};

const notify = () => {
    config.notificationUrls.forEach(async url => {
        try {
            const res = await axios.post(url, {status: statusMap[status]});
            log('Response code:', res.status);
        } catch(e) {
            if (e.response) {
                log('Response code:', e.response.status);
            } else {
                log('Error:', e.message);
            }
        }
    });
};

const createManageServer = port => new Promise((resolve, reject) => {
    const app = express();
    app.get('/status', (req, res) => {
        res.send({ power: statusMap[status == powerDetecting ? 0 : status] });
    });
    app.post('/correct', express.json(), (req, res) => {
        log('Correction requested', req.body);
        const newStatus = statusMap.indexOf(req.body.power);
        if (newStatus != -1) {
            status = newStatus;
            log('Power ' + statusMap[status]);
            clearTimeout(timer);
            notify();
        }
        res.send({ status: 'success' });
    });
    try {
        const srv = app.listen(port, () => {
            log('Server ready', port);
            resolve(srv);
        });
    } catch(e) {
        log('Server failed to start', e);
        reject(e);
    }
});

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
    const app = express();
    app.post('/', express.json(), (req, res) => {
        const signal = req.body.signal || port;
        log('Reported', signal, req.body);
        if (req.body.power) {
            onUpdate(req.body, signal);
        }
        res.sendStatus(201);
    });
    try {
        const srv = app.listen(port, () => {
            log('Report server listening', port);
            resolve(srv);
        });
    } catch(e) {
        log('Report server failed to start', e);
        reject(e);
    }
});

Promise.allSettled([...config.reportPorts.map(createReportServer), createManageServer(config.serverPort)])
    .then(settles => {
        if (settles.some(s => s.reason)) {
            log('Some servers could not start');
            settles.filter(s => s.value).forEach(s => s.value.close());
        } else {
            log('Ready');
        }
    });