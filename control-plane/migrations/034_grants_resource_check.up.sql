ALTER TABLE usage_grants ADD CONSTRAINT usage_grants_resource_check CHECK (resource IN ('cpu', 'gpu'));
