require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 4001,
  REST_API_URL: process.env.REST_API_URL || 'http://localhost:4000/api/documentos',
};