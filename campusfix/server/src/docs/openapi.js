const bearer = [{ bearerAuth: [] }];
const err = (d) => ({ description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'CampusFix API',
    version: '1.0.0',
    description:
      'REST API for the university maintenance and service request platform. ' +
      'Authenticate via POST /auth/login, then click "Authorize" and paste the JWT.',
  },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          details: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
        },
      },
      User: {
        type: 'object',
        properties: { id: { type: 'integer' }, name: { type: 'string' }, email: { type: 'string' }, role: { type: 'string', enum: ['requester', 'officer', 'admin'] } },
      },
      ServiceRequest: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, title: { type: 'string' }, description: { type: 'string' },
          location: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          status: { type: 'string', enum: ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'] },
          category: { type: 'string' }, requester_name: { type: 'string' }, officer_name: { type: 'string', nullable: true },
          has_attachment: { type: 'boolean' }, created_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    '/auth/register': {
      post: {
        tags: ['Auth'], summary: 'Register a student/staff account',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'email', 'password'], properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, password: { type: 'string', minLength: 8 } } } } } },
        responses: { 201: { description: 'Account created; returns { token, user }' }, 400: err('Validation failed'), 409: err('Email already registered') },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Log in and receive a JWT',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } } } } },
        responses: { 200: { description: 'Returns { token, user }' }, 401: err('Invalid credentials') },
      },
    },
    '/auth/me': { get: { tags: ['Auth'], summary: 'Current user', security: bearer, responses: { 200: { description: 'Current user' }, 401: err('Unauthenticated') } } },
    '/requests': {
      get: {
        tags: ['Requests'], summary: 'List requests (scoped by role) with search, filters and pagination', security: bearer,
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'priority', in: 'query', schema: { type: 'string' } },
          { name: 'category_id', in: 'query', schema: { type: 'integer' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
        ],
        responses: { 200: { description: '{ data: ServiceRequest[], pagination }' } },
      },
      post: {
        tags: ['Requests'], summary: 'Submit a request (multipart/form-data, optional image evidence)', security: bearer,
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['title', 'description', 'location', 'category_id'], properties: { title: { type: 'string' }, description: { type: 'string' }, location: { type: 'string' }, category_id: { type: 'integer' }, priority: { type: 'string' }, image: { type: 'string', format: 'binary' } } } } } },
        responses: { 201: { description: 'Created request' }, 400: err('Validation failed'), 403: err('Officers cannot submit') },
      },
    },
    '/requests/export/csv': { get: { tags: ['Requests'], summary: 'Export requests as CSV (admin)', security: bearer, responses: { 200: { description: 'text/csv' }, 403: err('Admin only') } } },
    '/requests/{id}': {
      get: { tags: ['Requests'], summary: 'Request detail with status timeline', security: bearer, parameters: [idParam], responses: { 200: { description: 'Request' }, 403: err('Not your request'), 404: err('Not found') } },
      put: { tags: ['Requests'], summary: 'Edit a request (owner while pending, or admin)', security: bearer, parameters: [idParam], responses: { 200: { description: 'Updated' }, 409: err('Not pending') } },
      delete: { tags: ['Requests'], summary: 'Delete a request (owner while pending, or admin)', security: bearer, parameters: [idParam], responses: { 204: { description: 'Deleted' } } },
    },
    '/requests/{id}/attachment': { get: { tags: ['Requests'], summary: 'Download the uploaded evidence image', security: bearer, parameters: [idParam], responses: { 200: { description: 'image' }, 404: err('None') } } },
    '/requests/{id}/assign': {
      post: {
        tags: ['Assignments'], summary: 'Assign (or re-assign) to a maintenance officer (admin)', security: bearer, parameters: [idParam],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['officer_id'], properties: { officer_id: { type: 'integer' } } } } } },
        responses: { 200: { description: 'Assigned' }, 400: err('Not an officer'), 409: err('Closed request') },
      },
    },
    '/requests/{id}/status': {
      patch: {
        tags: ['Assignments'], summary: 'Update status. Officers: assigned->in_progress->completed. Requesters: cancel pending.', security: bearer, parameters: [idParam],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'] }, note: { type: 'string' } } } } } },
        responses: { 200: { description: 'Updated' }, 403: err('Not allowed'), 409: err('Invalid transition') },
      },
    },
    '/categories': {
      get: { tags: ['Categories'], summary: 'List categories', security: bearer, responses: { 200: { description: '{ data }' } } },
      post: { tags: ['Categories'], summary: 'Create category (admin)', security: bearer, responses: { 201: { description: 'Created' } } },
    },
    '/users': {
      get: { tags: ['Users'], summary: 'List users, optional ?role= (admin)', security: bearer, responses: { 200: { description: '{ data }' } } },
      post: { tags: ['Users'], summary: 'Create user with any role (admin)', security: bearer, responses: { 201: { description: 'Created' } } },
    },
    '/users/{id}': { patch: { tags: ['Users'], summary: 'Change role or enable/disable (admin)', security: bearer, parameters: [idParam], responses: { 200: { description: 'Updated' } } } },
    '/notifications': { get: { tags: ['Notifications'], summary: 'My latest notifications', security: bearer, responses: { 200: { description: '{ data, unread }' } } } },
    '/notifications/read-all': { post: { tags: ['Notifications'], summary: 'Mark all read', security: bearer, responses: { 200: { description: 'ok' } } } },
    '/notifications/{id}/read': { patch: { tags: ['Notifications'], summary: 'Mark one read', security: bearer, parameters: [idParam], responses: { 200: { description: 'ok' } } } },
    '/stats': { get: { tags: ['Reports'], summary: 'Dashboard statistics for the current role', security: bearer, responses: { 200: { description: 'Counts by status (+ category, avg resolution time for admin)' } } } },
    '/audit': { get: { tags: ['Reports'], summary: 'Audit trail (admin)', security: bearer, responses: { 200: { description: '{ data, pagination }' } } } },
  },
};
