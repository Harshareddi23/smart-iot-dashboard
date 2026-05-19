# Smart Environment IoT Dashboard

## Project Overview

This project is a web-based IoT dashboard developed for monitoring and controlling a smart environment using a centralized IoT hub. The system provides real-time sensor monitoring, device control, and automation features through a user-friendly web interface.

## Features

- Real-time temperature monitoring
- Real-time humidity monitoring
- Motion detection monitoring
- Fan control
- Bulb control
- AC control
- User authentication (Login System)
- Automation settings for AC control
- Activity logging
- Real-time communication using Socket.io
- Simulated IoT devices and sensors

## Technologies Used

- HTML
- CSS
- JavaScript
- Node.js
- Express.js
- Socket.io
- JWT Authentication
- GitHub

## Project Architecture

Simulator → Node.js Server → Centralized IoT Dashboard

## Working

1. Sensors generate environmental data.
2. The simulator sends data to the Node.js server.
3. The dashboard displays sensor values in real time.
4. Users can remotely control devices.
5. Automation rules automatically control the AC based on temperature thresholds.

## Installation

```bash
npm install
node server.js
```

## Login Credentials

Username: admin

Password: admin123

## Future Enhancements

- Raspberry Pi integration
- Real IoT sensor deployment
- Cloud hosting
- Mobile application support
- Remote internet-based device control

## Author

Harshavardhan

## GitHub Repository

https://github.com/Harshareddi23/smart-iot-dashboard
