-- Keep the stable internal section slug (`events`) while updating its public name.
update editorial_sections
set name = 'Event Features',
    description = 'Member-written features, previews, reviews and perspectives about events.'
where slug = 'events';
