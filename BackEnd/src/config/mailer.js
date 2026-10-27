require("dotenv").config();
const nodemailer = require("nodemailer");

const transportador = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS?.replace(/\s+/g, ""),
  },
});

module.exports = transportador;
