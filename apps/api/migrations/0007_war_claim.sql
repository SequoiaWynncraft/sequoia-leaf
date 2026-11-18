-- Whether a war was fought over a territory in Sequoia's claim, as the backend
-- reports it: the guild taking back its own ground, which pays more Leaf per
-- war point. NULL for raids, for wars recorded before the backend said, and for
-- wars it could not place.

ALTER TABLE activities ADD COLUMN in_claim INTEGER CHECK (in_claim IN (0, 1));
