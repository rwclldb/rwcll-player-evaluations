
-- Standard RWCLL player evaluation rating categories.
-- Safe to rerun: category codes are unique.

INSERT INTO public.rating_categories
  (code, name, category_group, sort_order)
VALUES
  ('hitting', 'Hitting', 'core', 1),
  ('throwing', 'Throwing', 'core', 2),
  ('grounders', 'Grounders', 'core', 3),
  ('fly_balls', 'Fly Balls', 'core', 4),
  ('running_awareness', 'Running / Awareness', 'core', 5),
  ('pitching_mechanics', 'Pitching Mechanics', 'pitching', 6),
  ('pitching_accuracy_control', 'Pitching Accuracy/Control', 'pitching', 7),
  ('pitching_arm_strength', 'Pitching Arm Strength', 'pitching', 8),
  ('catching_receiving', 'Catching/Receiving', 'catching', 9),
  ('catching_blocking', 'Catching/Blocking', 'catching', 10),
  ('catching_throwing', 'Catching Throwing', 'catching', 11)
ON CONFLICT (code) DO NOTHING;
