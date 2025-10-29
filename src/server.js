const { typeDefs, resolvers } = require('./graphql');
const { PORT } = require('./config');
const { ApolloServer } = require('apollo-server-express');
const express = require('express');
const { setupDownloadRoutes } = require('./controllers/downloadController');

async function startServer() {
  const app = express();

  const server = new ApolloServer({ typeDefs, resolvers });

  //Servidor de GraphQL
  await server.start();

  // Middleware de Apollo a Express
  server.applyMiddleware({ app });

  setupDownloadRoutes(app);

  // Servir archivos estáticos
  app.use('/static', express.static('public'));

  app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en http://localhost:${PORT}${server.graphqlPath}`);
    console.log(`Descargas disponibles en http://localhost:${PORT}/download/`);
  });
}

startServer().catch(error => {
  console.error('Error al iniciar el servidor:', error);
});