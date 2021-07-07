const Session = require('./session');

class StatusSession extends Session {
    constructor (socket) {
        super(socket);
        this.services = null;
    }

    async didReceiveCall (method, params, completion) {
        switch (method) {
            case 'status':
                this.status();
                completion(null, null);
                break;
            default:
                throw new Error(`Method not found`);
        }
    }

    status () {
        if (this.services) {
            throw new Error('Get status error when connected');
        } else {
            this.sendRemoteRequest('status', {
                result: 'ok'
            });
        }
    }
}

module.exports = StatusSession;
