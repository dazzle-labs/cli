ALTER TABLE stages ADD COLUMN featured BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE stages SET featured = true WHERE id IN ('8cfe30b67025', '66fc2f10bf4f', '2f7b5d4e5367');
