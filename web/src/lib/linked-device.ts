// A young profile's own device, linked by a parent's code: it opens that profile only, so nothing offers to switch
// ("Qui lit ?", the sidebar's selector, "Changer de profil"). Set from the session before the app shows anything.
let linked = false

export const setLinkedDevice = (value: boolean) => {
  linked = value
}

export const isLinkedDevice = () => linked
