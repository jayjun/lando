/**
 * Lando php service builder
 *
 * @name php
 */

'use strict';

module.exports = function(lando) {

  // Modules
  var _ = require('lodash');
  var addConfig = lando.services.addConfig;
  var addScript = lando.services.addScript;
  var buildVolume = lando.services.buildVolume;

  // "Constants"
  var defaultConfDir = lando.config.engineConfigDir;

  /**
   * Supported versions for php
   */
  var versions = [
    '5.3',
    '5.5',
    '5.6',
    '7.0',
    'latest',
    'custom'
  ];

  /**
   * Return the networks needed
   */
  var networks = function() {
    return {};
  };

  /*
   * Parse our config
   */
  var parseConfig = function(config) {

    // Get the version and type
    var version = config.version || '7.0';
    var via = config.via.split(':')[0] || 'nginx';

    // Define type specific config things
    var typeConfig = {
      nginx: {
        web: 'nginx',
        command: ['php-fpm'],
        image: [version, 'fpm'].join('-'),
        serverConf: '/etc/nginx/conf.d/default.conf'
      },
      apache: {
        web: 'apache',
        command: ['apache2-foreground'],
        image: [version, 'apache'].join('-'),
        serverConf: '/etc/apache2/sites-available/000-default.conf',
      }
    };

    // Add the docker php entrypoint if we are on a supported php version
    if (version.split('.').join('') > 55) {
      typeConfig[via].command.unshift('docker-php-entrypoint');
    }

    // Return type specific config
    return _.merge(config, typeConfig[via]);

  };

  /*
   * Build php
   */
  var php = function(config) {

    // Start with the php base
    var php = {
      image: 'kalabox/php:' + config.image,
      environment: {
        TERM: 'xterm'
      },
      ports: ['80'],
      volumes: [],
      command: config.command.join(' '),
    };

    // If this is apache lets do some checks
    if (config.web === 'apache' && config.ssl) {

      // Add the ssl port
      php.ports.push('443');

      // If we don't have a custom default ssl config lets use the default one
      var sslConf = ['php', 'httpd-ssl.conf'];
      var sslVolume = buildVolume(sslConf, config.serverConf, defaultConfDir);
      php.volumes = addConfig(sslVolume, php.volumes);

      // Add in an add cert task
      php.volumes = addScript('add-cert.sh', php.volumes);

    }

    // If this being delivered via nginx we need to modify some things
    if (config.web === 'nginx') {

      // Make sure network alias exists
      php.networks = {default: {aliases: ['fpm']}};

      // Set ports to empty
      php.ports = [];

    }

    // REturn the service
    return php;

  };

  /*
   * Build nginx
   */
  var nginx = function(config) {

    // Add a version to the type if applicable
    var type = ['nginx', config.via.split(':')[1]].join(':');

    // Handle our nginx config
    var defaultConfFile = (config.ssl) ? 'default-ssl.conf' : 'default.conf';
    var configFile = ['php', defaultConfFile];
    var mount = buildVolume(configFile, config.serverConf, defaultConfDir);
    var nginxConfigDefaults = {
      server: mount.split(':')[0]
    };

    // Set the nginx config
    config.config = _.merge(nginxConfigDefaults, config.config);

    // Generate a config object to build the service with
    var name = config.name;
    var nginx = lando.services.build(name, type, config).services[name];

    // On darwin or if sharing is off we can just share the volume since we do
    // not have potential volume transitivity via sharing
    if (process.platform === 'darwin' || lando.config.sharing !== 'ON') {
      nginx.volumes.push([name, '/var/www/html'].join(':'));
    }

    // on Linux and Windoze we need to make sure we also add sharing to nginx if applicable
    else if (!_.isEmpty(config.sharing[name])) {
      config.sharing.nginx = config.sharing[name];
    }

    // Return the object
    return nginx;

  };

  /*
   * Build a starting point for our service
   * lets delegate this since php is complicated
   */
  var buildAppserver = function(config) {

    // Start a services collector
    var services = {};

    // Build the correct "appserver"
    services[config.name] = php(config);

    // Add nginx delivery if we are doing nginx
    if (config.web === 'nginx') {
      services.nginx = nginx(config);
    }

    // Return things
    return services;

  };

  /**
   * Build out php
   */
  var services = function(name, config) {

    // Parse our config
    config.name = name;
    config = parseConfig(config);

    // Get basic services things
    var services = buildAppserver(config);

    // Define config mappings
    var configFiles = {
      webroot: '/var/www/html',
      php: {
        conf: '/usr/local/etc/php/php.ini'
      },
      web: {
        server: config.serverConf
      }
    };

    // Handle custom web config files/dirs
    var web = (config.web === 'nginx') ? 'nginx' : name;
    _.forEach(configFiles.web, function(file, type) {
      if (_.has(config, 'config.' + type)) {
        var local = config.config[type];
        var customConf = buildVolume(local, file, '$LANDO_APP_ROOT_BIND');
        services[web].volumes = addConfig(customConf, services[web].volumes);
      }
    });

    // Handle custom php config files/dirs
    _.forEach(configFiles.php, function(file, type) {
      if (_.has(config, 'config.' + type)) {
        var local = config.config[type];
        var customConf = buildVolume(local, file, '$LANDO_APP_ROOT_BIND');
        var volumes = services[name].volumes;
        services[name].volumes = addConfig(customConf, volumes);
      }
    });

    // Return our service
    return services;

  };

  /**
   * Metadata about our service
   */
  var info = function(name, config) {

    // Start up an info collector
    var info = {};

    // Add in appserver basics
    info.via = config.via;

    // Return the collected info
    return info;

  };

  /**
   * Return the volumes needed
   */
  var volumes = function(name) {

    // Construct our volumes
    var volumes = {
      data: {}
    };

    // Add the appserver
    volumes[name] = {};

    // Return the volumes
    return volumes;

  };

  return {
    info: info,
    networks: networks,
    services: services,
    versions: versions,
    volumes: volumes,
    configDir: __dirname
  };

};