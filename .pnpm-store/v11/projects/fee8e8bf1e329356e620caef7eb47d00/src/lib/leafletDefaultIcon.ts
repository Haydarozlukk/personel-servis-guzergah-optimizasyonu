// react-leaflet's default Marker icon resolves image URLs relative to the
// page, not the bundle, so in a Vite build the retina icon and shadow 404
// (https://github.com/PaulLeCam/react-leaflet/issues/453). Importing the
// assets explicitly and pointing L.Icon.Default at them fixes this for every
// <Marker> that doesn't set its own icon.
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

type IconDefaultPrototype = typeof L.Icon.Default.prototype & { _getIconUrl?: unknown }

delete (L.Icon.Default.prototype as IconDefaultPrototype)._getIconUrl

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})
