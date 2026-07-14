import React, { useState, useEffect } from 'react';

export default function BookingInterface({ lawyerName, userEmail, onClose }) {
  const [selectedDate, setSelectedDate] = useState('');
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedTime, setSelectedTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  // Fetch open slots whenever the user changes the calendar date
  useEffect(() => {
    if (!selectedDate) return;

    async function fetchSlots() {
      setLoading(true);
      setSelectedTime(''); // Reset selected time on date change
      setMessage({ text: '', type: '' });
      try {
        const response = await fetch(`http://127.0.0.1:8000/api/availability?date=${selectedDate}`);
        const data = await response.json();
        if (response.ok) {
          setAvailableSlots(data.available_slots);
        } else {
          setMessage({ text: data.detail || 'Failed to load times.', type: 'error' });
        }
      } catch (err) {
        setMessage({ text: 'Could not connect to backend server.', type: 'error' });
      } finally {
        setLoading(false);
      }
    }

    fetchSlots();
  }, [selectedDate]);

  // Handle the final submission to create the calendar event
  async function handleBooking() {
    if (!selectedDate || !selectedTime) return;

    setLoading(true);
    setMessage({ text: '', type: '' });

    try {
      const response = await fetch('http://127.0.0.1:8000/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lawyer_name: lawyerName,
          user_email: userEmail,
          date: selectedDate,
          time: selectedTime
        })
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ 
          text: `✅ Success! Booked for ${selectedDate} at ${selectedTime}. Please save your meeting link: ${data.meet_link}`, 
          type: 'success' 
        });      
        
        // Remove the booked slot from the active UI view immediately
        setAvailableSlots(prev => prev.filter(t => t !== selectedTime));
        setSelectedTime('');
      } else {
        setMessage({ text: data.detail || 'Booking failed.', type: 'error' });
      }
    } catch (err) {
      setMessage({ text: 'Network connection failed.', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-xl shadow-md border border-gray-100">
      <h2 className="text-xl font-bold text-gray-800 mb-1">Book Consultation</h2>
      <p className="text-sm text-gray-500 mb-4">with {lawyerName}</p>

      {/* Date Picker Input */}
      <div className="mb-4">
        <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Select Date</label>
        <input 
          type="date" 
          className="w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          min={new Date().toISOString().split('T')[0]} // Prevents picking past dates
        />
      </div>

      {/* Loading Indicator */}
      {loading && <p className="text-sm text-blue-500 animate-pulse my-2">Checking schedule availability...</p>}

      {/* Available Slots Grid */}
      {selectedDate && !loading && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Available Times</label>
          {availableSlots.length === 0 ? (
            <p className="text-sm text-red-500 bg-red-50 p-2 rounded">No open slots left on this date. Try another day!</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {availableSlots.map((time) => (
                <button
                  key={time}
                  type="button"
                  onClick={() => setSelectedTime(time)}
                  className={`p-2 text-sm font-medium rounded-lg border text-center transition-all ${
                    selectedTime === time 
                      ? 'bg-blue-600 border-blue-600 text-white shadow-sm' 
                      : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {time}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* System Warning/Success Banners */}
      {message.text && (
        <div className={`p-3 text-sm rounded-lg mb-4 ${
          message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
        }`}>
          {message.text}
        </div>
      )}

      {/* Complete Booking Trigger Button */}
      <button
        disabled={!selectedTime || loading}
        onClick={handleBooking}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition duration-200 mb-2"
      >
        Confirm Appointment
      </button>
      
      {/* New Cancel Button */}
      <button 
        onClick={onClose} 
        className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg transition duration-200"
      >
        Cancel
      </button>
    </div>
  );
}