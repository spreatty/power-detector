const express = require('express');
const axios = require('axios');
const config = require('./config.json');

const log = (...args) => console.log(new Date().toLocaleString(), ...args);
const isTrue = value => value;

const reportedOff = 0, reportedOn = 1;
const reportMap = ['off', 'on'];
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

const onUpdate = () => {
    const powerSignals = Object.values(signals).filter(isTrue).length;
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

(async () => {
    const app = express();
    app.post('/report/:signal/:power', (req, res) => {
        log('Reported', req.params);
        const signal = req.params.signal;
        const power = reportMap.indexOf(req.params.power);
        if (power != -1) {
            signals[signal] = power == reportedOn;
            onUpdate();
        }
        res.sendStatus(201);
    });
    app.get('/status', (req, res) => {
        res.send({ power: statusMap[status == powerDetecting ? 0 : status] });
    });
    app.post('/correct', express.json(), (req, res) => {
        log('Correction requested', req.body);
        const newStatus = statusMap.indexOf(req.body.power);
        if (newStatus == -1) {
            res.sendStatus(400);
            return;
        }
        status = newStatus;
        log('Power', statusMap[status]);
        clearTimeout(timer);
        notify();
        res.sendStatus(201);
    });
    
    await new Promise(resolve => app.listen(config.port, resolve));
    log('Server ready', config.port);
})();