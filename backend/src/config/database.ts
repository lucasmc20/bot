require("../bootstrap");

module.exports = {
  define: {
    charset: "utf8mb4",
    collate: "utf8mb4_bin"
  },
  dialect: process.env.DB_DIALECT || "mysql",
  timezone: "-03:00",
  host: "localhost",
  database: "versao_final",
  username: "root",
  password: "@senha.123",
  logging: false
};
