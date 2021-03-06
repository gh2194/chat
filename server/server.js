/* eslint
    no-param-reassign: ["error", { "props": true, "ignorePropertyModificationsFor": ["socket"] }]
*/

'use strict';

require('colors');
const moment = require('moment');
const express = require('express');

const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const { prepareMsg, prepareLocation } = require('./utils/message.js');
const { validateJoinParams } = require('./utils/join.js');
const { Users } = require('./utils/users.js');
const staticPath = require('path').join(__dirname, '../public');

const PORT = process.env.PORT || 3000;

// block src files
app.use((req, res, next) => {
  const result = decodeURI(req.url).match(/^.*src.*$/i);
  if (result) return res.status(404).end();
  return next();
});

app.use(express.static(staticPath));

const users = Users();

app.get('/rooms', (req, res) => {
  // console.log('received GET /rooms');
  res.send(users.getRoomList());
});

server.listen(PORT, () => console.log(`Server started on ${PORT}`));

let connCounter = 0;

io.on('connection', (socket) => {
  // User IP logging (proxy aware)
  // const ip1 = socket.request.connection.remoteAddress;
  // const ip2 = socket.handshake.headers['x-forwarded-for'];
  // const clientIP = ip2 || ip1;
  const clientIP = '_'; // privacy
  connCounter += 1;
  const { id } = socket;
  let room = null;
  console.log(moment().format('hh:mm:ss.SSS a'), 'Connection:'.green, id, clientIP, 'User Count:', connCounter);

  // direct message to welcome user
  socket.emit('newMessage', prepareMsg({
    fromName: 'Admin',
    fromId: 'Server',
    text: 'Welcome To Chat',
  }));

  // incoming join request with cb
  socket.on('join', (params, cb) => {
    // console.log(moment().format('hh:mm:ss.SSS a'), 'Join Request:'.yellow, params);

    if (!validateJoinParams(params)) return cb('error: blank and/or invalid join request property name(s) and/or value(s)');

    ({ room } = params);
    room = room.toLowerCase();

    if (users.getUserList(params.room).includes(params.name)) return cb('error: user by that name already exists in this room');

    users.deleteUser(socket.id); // user can only be in a single room at a time
    socket.join(room);
    users.addUser(socket.id, params.name, room);

    // broadcast to all others to let them know a user joined
    socket.broadcast.to(room).emit('newMessage', prepareMsg({
      fromName: 'Admin',
      fromId: 'Server',
      text: `${params.name} has joined the room`,
    }));

    // broadcast to all room participants the room list
    io.to(room).emit('updateUserList', users.getUserList(params.room));

    return cb();
  });

  // incoming message with cb
  socket.on('createMessage', (msg, cb) => {
    // console.log(moment().format('hh:mm:ss.SSS a'), 'Message:'.yellow, id, msg);
    const msgOut = prepareMsg(msg);
    if (!msgOut) return cb('error: blank and/or invalid message property name(s) and/or value(s)');
    io.to(room).emit('newMessage', msgOut);
    return cb();
  });

  // incoming location with cb
  socket.on('createLocation', (location, cb) => {
    // console.log(moment().format('hh:mm:ss.SSS a'), 'Message:'.yellow, id, location);
    const locationOut = prepareLocation(location);
    if (!locationOut) return cb('error: blank and/or invalid location message property name(s) and/or value(s)');
    io.to(room).emit('newLocation', locationOut);
    return cb();
  });

  // disconnections
  socket.on('disconnect', (reason) => {
    const user = users.getUser(socket.id);
    if (user) {
      users.deleteUser(socket.id);
      // broadcast to all room participants the room list
      socket.broadcast.to(room).emit('newMessage', prepareMsg({
        fromName: 'Admin',
        fromId: 'Server',
        text: `${user.name} has left the room`,
      }));
      socket.broadcast.to(room).emit('updateUserList', users.getUserList(room));
    }
    connCounter -= 1;
    console.log(moment().format('hh:mm:ss.SSS a'), 'Disconnection'.red, id, clientIP, 'User Count:', connCounter, 'Reason:', reason);
  });
});
