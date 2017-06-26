// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const factoryLogger = require('./logger');
const AzureStorage = require('azure-storage');

function createBlobService(account, key) {
  factoryLogger.info(`creating blob service`);
  const retryOperations = new AzureStorage.ExponentialRetryPolicyFilter();
  return AzureStorage.createBlobService(account, key).withFilter(retryOperations);
}

function createTableService(account, key) {
  factoryLogger.info(`creating table service`);
  const retryOperations = new AzureStorage.ExponentialRetryPolicyFilter();
  return AzureStorage.createTableService(account, key).withFilter(retryOperations);
}

exports.createBlobService = createBlobService;
exports.createTableService = createTableService;