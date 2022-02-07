# Certificates

These measures are to avoid the following error.

```
Mixed Content: The page at 'https:/xxx' was loaded over HTTPS, but attempted to connect to the insecure WebSocket endpoint 'ws://127.0.0.1/xxx'. This request has been blocked; this endpoint must be available over WSS.
```

When the browser security settings are high, the https web program will be blocked when trying to establish a local ws connection, so we must create a wss socket.

To create a secure websocket server. We have to generate a self-signed certificate. Don't worry about safety issues, all device data is interacted locally on the computer during actual operation. You can also generate a key yourself with the following command.

```
openssl genrsa -out key.pem
openssl req -new -key key.pem -out csr.pem
openssl x509 -req -days 9999 -in csr.pem -signkey key.pem -out cert.pem
rm csr.pem
```
