const {Client} = require('pg')

const client = new Client({
    host: "localhost",
    user: process.env.DB_USER,
    port: 8888,
    password: process.env.DB_PASSWORD,
    database: "ApplicationTracker"
})

client.connect()
    .then(() => console.log("Connected to PostgreSQL"))
    .catch((err) => console.error("Connection error", err.stack));

module.exports = client;