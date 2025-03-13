import heapq
import time

class SharedPriorityQueue:
    def __init__(self, manager):
        self._queue = manager.list([])  # ListProxy
        self._lock = manager.Lock()

    def put(self, item):
        with self._lock:
            temp_list = list(self._queue)
            heapq.heappush(temp_list, item)
            self._queue[:] = temp_list

    def get(self):
        # Bloque jusqu'à ce qu'un élément soit disponible
        while True:
            with self._lock:
                if len(self._queue) > 0:
                    temp_list = list(self._queue)
                    item = heapq.heappop(temp_list)
                    self._queue[:] = temp_list
                    return item
            time.sleep(0.01)  # Petite pause pour éviter un busy-wait trop intensif

    def empty(self):
        with self._lock:
            return len(self._queue) == 0

    def qsize(self):
        with self._lock:
            return len(self._queue)
