UPDATE api_keys SET prefix = substring(prefix, 1, 7) || '...' WHERE length(prefix) > 10;
