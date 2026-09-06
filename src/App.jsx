import React, { useEffect, useState, useRef } from 'react'
import { supabase } from './supabase'
import L from 'leaflet'

export default function App() {
  const [name, setName] = useState('')
  const [roomId, setRoomId] = useState('demo')
  const [joined, setJoined] = useState(false)
  const [copyMsg, setCopyMsg] = useState('')
  const mapRef = useRef(null)
  const markersRef = useRef({})
  const sessionIdRef = useRef(null)
  const participantRefRef = useRef(null)

  useEffect(() => {
    // read room from URL path /r/<id>
    try {
      const m = window.location.pathname.match(/^\/r\/(.+)$/)
      if (m && m[1]) setRoomId(m[1])
    } catch (e) {
      // ignore
    }

    // create stable session id
    sessionIdRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('id-' + Math.random().toString(36).slice(2, 9))
  }, [])

  useEffect(() => {
    // initialize map
    mapRef.current = L.map('map').setView([20, 0], 2)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mapRef.current)

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!joined) return
    const updateMarkers = participants => {
      const activeIds = new Set(participants.map(participant => participant.participant_id))
      Object.keys(markersRef.current).forEach(id => {
        if (!activeIds.has(id)) {
          mapRef.current.removeLayer(markersRef.current[id])
          delete markersRef.current[id]
        }
      })
      participants.forEach(participant => {
        if (participant.latitude == null || participant.longitude == null) return
        const position = [participant.latitude, participant.longitude]
        if (!markersRef.current[participant.participant_id]) {
          markersRef.current[participant.participant_id] = L.marker(position)
            .addTo(mapRef.current)
            .bindPopup(participant.name || 'Anonymous')
        } else {
          markersRef.current[participant.participant_id].setLatLng(position)
          markersRef.current[participant.participant_id].getPopup().setContent(participant.name || 'Anonymous')
        }
      })
    }

    const loadParticipants = async () => {
      const { data, error } = await supabase
        .from('room_participants')
        .select('*')
        .eq('room_id', roomId)
      if (error) console.error('Could not load participants', error)
      else updateMarkers(data || [])
    }

    loadParticipants()

    const channel = supabase
      .channel(`room-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_participants', filter: `room_id=eq.${roomId}` }, payload => {
        if (payload.eventType === 'DELETE') {
          updateMarkers((Object.values(markersRef.current)).map(marker => ({
            participant_id: Object.keys(markersRef.current).find(id => markersRef.current[id] === marker),
            latitude: marker.getLatLng().lat,
            longitude: marker.getLatLng().lng,
            name: marker.getPopup()?.getContent()
          })).filter(participant => participant.participant_id !== payload.old.participant_id))
        } else {
          const participant = payload.new
          const marker = markersRef.current[participant.participant_id]
          const position = [participant.latitude, participant.longitude]
          if (!marker) {
            markersRef.current[participant.participant_id] = L.marker(position).addTo(mapRef.current).bindPopup(participant.name || 'Anonymous')
          } else {
            marker.setLatLng(position)
            marker.getPopup().setContent(participant.name || 'Anonymous')
          }
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [joined, roomId])

  useEffect(() => {
    let watchId = null
    if (!joined) return

    const startTracking = () => {
      if (!('geolocation' in navigator)) return alert('Geolocation not supported')
      // stable id per session
      const id = sessionIdRef.current || ('id-' + Math.random().toString(36).slice(2, 9))
      participantRefRef.current = id

      watchId = navigator.geolocation.watchPosition(pos => {
        const { latitude: lat, longitude: lng } = pos.coords
        supabase.from('room_participants').upsert({
          room_id: roomId,
          participant_id: id,
          name,
          latitude: lat,
          longitude: lng,
          last_seen: new Date().toISOString()
        }, { onConflict: 'room_id,participant_id' }).then(({ error }) => {
          if (error) console.error('Could not share location', error)
        })
      }, err => {
        console.error('geo error', err)
      }, { enableHighAccuracy: false, maximumAge: 5000, timeout: 10000 })
    }

    startTracking()

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      if (participantRefRef.current) {
        supabase.from('room_participants')
          .delete()
          .eq('room_id', roomId)
          .eq('participant_id', participantRefRef.current)
      }
    }
  }, [joined, name, roomId])

  const createRoom = () => {
    // simple short id
    const id = Math.random().toString(36).slice(2, 8)
    setRoomId(id)
    // update URL so the share link is clean
    try {
      const newPath = `/r/${id}`
      window.history.replaceState(null, '', newPath)
    } catch (e) {
      // ignore on environments where history is restricted
    }
  }

  const handleJoin = () => {
    if (!name) return alert('Enter a display name')
    setJoined(true)
  }

  const shareLink = `${window.location.origin}/r/${roomId}`

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink)
      setCopyMsg('Copied!')
      setTimeout(() => setCopyMsg(''), 2000)
    } catch (e) {
      setCopyMsg('Copy failed')
      setTimeout(() => setCopyMsg(''), 2000)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ width: '320px', padding: '16px', boxSizing: 'border-box' }}>
        <h2>Where Are We (WAW)</h2>
        <label>Room ID</label>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <input value={roomId} onChange={e => setRoomId(e.target.value)} style={{ flex: 1 }} />
          <button onClick={createRoom} disabled={joined}>Create Room</button>
        </div>
        <label>Display name</label>
        <input value={name} onChange={e => setName(e.target.value)} />
        <button onClick={handleJoin} disabled={joined} style={{ marginTop: '8px' }}>Join & Share Location</button>
        <div style={{ marginTop: '12px', wordBreak: 'break-all' }}>
          <div>Share this link:</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <a href={shareLink}>{shareLink}</a>
            <button onClick={copyLink}>Copy</button>
            <span style={{ marginLeft: '8px' }}>{copyMsg}</span>
          </div>
        </div>
      </div>
      <div id="map" style={{ flex: 1 }}></div>
    </div>
  )
}
