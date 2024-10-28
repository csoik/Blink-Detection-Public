import cv2
import os
import time
from datetime import datetime
from pynput import keyboard

blinkTime = 0 #Place-holder for the most recent blink time
video_duration = 5 #Seconds of footage to keep per file, up to 2x this duration is stored around a blink event

#Try to open the camera device
#Returns two values: (1) the open cam stream and (2) the camera index
#Returns NONE, -1 if no cameras could open
def get_video_device():
    # Try to open the default camera
    for index in range(3): #Try the first 3 camera devices.  TODO: detect actual number of cameras
        cap = cv2.VideoCapture(index)
        if cap.isOpened():
            return cap, index
    return None, -1 #If no cameras worked, return dud values

def on_press(key):
    try:
        print('alphanumeric key {0} pressed'.format(key.char))
        
        #Set the current blink time if no blink exists in the current file
        global blinkTime
        blinkTime = time.time()
        print("Blink simulated with 'b' key at", datetime.fromtimestamp(blinkTime).strftime('%H:%M:%S'))

    except AttributeError as e:
        print('special key {0} pressed'.format(
            key))
        print(e)
    except Exception as e:
        print(e)

def main():
    cap, capIndex = get_video_device()

    if capIndex == -1 or cap is None:
        print("No camera device found.")
        return

    fps = 30
    frame_size = (640, 480)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, frame_size[0])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, frame_size[1])
    cap.set(cv2.CAP_PROP_FPS, fps)

    # Setup keyboard listener, used to fake blink events with 'b' key
    listener = keyboard.Listener(
        on_press=on_press)
    listener.start()
    
    files = []
    current_writer = None
    start_time = time.time()

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("Can't receive frame (stream end?). Exiting ...")
                break

            current_time = time.time()

            #Make a new file if:
            # 1 The reader is null (1st file of the run) OR
            # 2 Existing file is at least 30s long OR
            # 3 Current file is at least 15s long AND 15s since the latest blink
            if current_writer is None or current_time - start_time > video_duration*2 or (current_time - start_time > video_duration and current_time - blinkTime > video_duration):
                if current_writer:
                    current_writer.release()
                print("Making new file.  BlinkTime is: ", datetime.fromtimestamp(blinkTime).strftime('%H:%M:%S'), " Current time is: ", datetime.fromtimestamp(current_time).strftime('%H:%M:%S'))
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                output_filename = f"output_{timestamp}.mp4"

                fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                current_writer = cv2.VideoWriter(output_filename, fourcc, fps, frame_size)
                files.append(output_filename)
                start_time = time.time() #Get time again instead of using current_time to avoid under-estimation from processing delays

                if len(files) > 2:
                    os.remove(files.pop(0))

            current_writer.write(frame)
            cv2.imshow("video", frame)
            cv2.waitKey(10) #Wait 33ms (30fps)

    except KeyboardInterrupt:
        print("Recording stopped by user")
    finally:
        if current_writer:
            current_writer.release()
        cap.release()
        cv2.destroyAllWindows()

if __name__ == "__main__":
    main()