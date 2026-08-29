// public/js/tenant-world-edit-bootstrap.js — setting.js より先に Tenant API shim を有効化
import './tenant-runtime-shim.js';
import { installTenantAdminWorldEditShim } from './tenant-admin-world-edit-shim.js';

installTenantAdminWorldEditShim();
