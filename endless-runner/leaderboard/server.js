const io = require('socket.io')(3000, { cors: { origin: "*" } });
let scores = [];

io.on('connection', (socket) => {
    socket.emit('update', scores);

    socket.on('newScore', (data) => {
        scores.push(data); 
        scores.sort((a, b) => b.distance - a.distance); 
        scores = scores.slice(0, 10); 
        io.emit('update', scores); 
    });
});
console.log("Server is running perfectly on port 3000!");
