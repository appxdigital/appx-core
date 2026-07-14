/**
 * Mock for `@adminjs/prisma/lib/Property`. See test/mocks/adminjs.cjs for the
 * reason this exists. Provides a minimal Property stub.
 */
class Property {
    constructor(field, model, _, position) {
        this.field = field;
        this.model = model;
        this.position = position;
    }
    name() { return this.field?.name ?? 'mock'; }
    isVisible() { return true; }
    isEditable() { return true; }
    type() { return 'string'; }
}

module.exports = { Property };
