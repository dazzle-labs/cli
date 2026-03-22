ALTER TABLE stages ADD COLUMN featured BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE stages SET featured = true WHERE id IN (
  '019d0be9-5aad-7e72-b044-8cfe30b67025',
  '019d122f-fd2b-7cbf-81bb-66fc2f10bf4f',
  '019d076e-c365-70e8-91dc-2f7b5d4e5367'
);
