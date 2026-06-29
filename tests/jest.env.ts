// Herhangi bir src modülü (özellikle @config/env) import edilmeden ÖNCE çalışır.
// Test ortamını deterministik kurar: NODE_ENV='test' + .env.test'i override ile yükle.
// override:true → process.env'de önceden kalmış dev değerleri (.env) ezilir,
// böylece testler her zaman 5433 test DB'sine ve silent log'a bağlanır.
import { config as loadDotenv } from 'dotenv';

process.env.NODE_ENV = 'test';
loadDotenv({ path: '.env.test', override: true });
