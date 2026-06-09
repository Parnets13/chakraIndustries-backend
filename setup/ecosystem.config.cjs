/**
 * PM2 ecosystem config for Sri Chakra Industries ERP backend
 * Runs the Node.js backend as a persistent Windows service via PM2
 */
module.exports = {
  apps: [
    {
      name        : 'chakra-erp-backend',
      script      : 'server.js',
      cwd         : 'D:\\chakara\\chakar-backened\\chakraIndustries-backend',
      interpreter : 'node',
      node_args   : '',

      // Auto-restart settings
      watch         : false,          // don't watch files in prod
      autorestart   : true,
      max_restarts  : 20,
      min_uptime    : '10s',          // must stay up at least 10s to count as successful start
      restart_delay : 5000,           // wait 5s between restarts

      // Environment
      env: {
        NODE_ENV : 'production',
        PORT     : '5001',
      },

      // Logging
      log_date_format : 'YYYY-MM-DD HH:mm:ss',
      out_file        : 'D:\\chakara\\logs\\erp-out.log',
      error_file      : 'D:\\chakara\\logs\\erp-error.log',
      merge_logs      : true,

      // Memory limit — restart if backend leaks past 1 GB
      max_memory_restart: '1G',
    },
  ],
};
