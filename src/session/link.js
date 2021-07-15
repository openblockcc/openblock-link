const Session = require('./session');

class LinkStatusSession extends Session {
    constructor (socket) {
        super(socket);
    }

    async didReceiveCall (method, params, completion) {
        switch (method) {
            case 'status':
                this.sendRemoteRequest('status', {
                    result: 'ok'
                });
                completion(null, null);
                break;
            default:
                throw new Error(`Method not found`);
        }
    }
}

module.exports = LinkStatusSession;
